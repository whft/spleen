import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTeamsStore } from './store.js';
import { createTeamsService } from './service.js';
import { registerTeamsRoutes } from './routes.js';

const tempDirs = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const setupTeams = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-teams-'));
  tempDirs.push(dir);
  let seq = 0;
  let clock = 1_000;
  const sentPrompts = [];
  const events = [];
  const statuses = new Map();
  const replies = new Map();

  const sessionService = {
    create: vi.fn(async ({ directory, title }) => {
      seq += 1;
      return { sessionId: `ses_${seq}`, directory, title };
    }),
    send: vi.fn(async ({ sessionId, prompt }) => {
      sentPrompts.push({ sessionId, prompt });
      return { id: `msg_${sentPrompts.length}` };
    }),
    abort: vi.fn(async () => undefined),
  };

  const store = createTeamsStore({ filePath: path.join(dir, 'teams.json') });
  const service = createTeamsService({
    store,
    sessionService,
    readSessionStatus: async (sessionId) => statuses.get(sessionId) ?? { type: 'busy' },
    readLastAssistantMessage: async (sessionId) => replies.get(sessionId) ?? null,
    broadcastEvent: (e) => events.push(e),
    now: () => clock,
  });

  return {
    store,
    service,
    sentPrompts,
    events,
    statuses,
    replies,
    advance: (ms) => { clock += ms; },
  };
};

describe('teams service & routes', () => {
  it('creates teams with presets, dispatches board @mentions, and schedules DAG tasks cleanly', async () => {
    const ctx = await setupTeams();
    const team = await ctx.service.createTeam({
      name: 'Release Squad',
      goal: 'Ship v1',
      directory: 'C:/repo',
      preset: 'bug-hunt',
      initialTasks: [
        { id: 't1', title: 'Reproduce bug', assignee: 'investigator', prompt: 'Find root cause' },
        { id: 't2', title: 'Fix bug', assignee: 'fixer', dependsOn: ['t1'], prompt: 'Implement patch' },
      ],
    });
    expect(team.members).toHaveLength(4);
    expect(team.tasks.find((t) => t.id === 't1').status).toBe('running');
    expect(team.tasks.find((t) => t.id === 't2').status).toBe('pending');
    expect(ctx.sentPrompts.some((p) => p.prompt.includes('Find root cause'))).toBe(true);

    // Complete t1 and advance clock -> t2 should automatically dispatch with t1 output!
    const investigatorSession = team.members.find((m) => m.role === 'investigator').sessionId;
    ctx.statuses.set(investigatorSession, { type: 'idle' });
    ctx.replies.set(investigatorSession, { completedAt: 1_100, text: 'Root cause is off-by-one.' });
    ctx.advance(500);
    await ctx.service.tickScheduler(team.id);

    const updated = await ctx.service.getTeam(team.id);
    expect(updated.tasks.find((t) => t.id === 't1').status).toBe('completed');
    expect(updated.tasks.find((t) => t.id === 't2').status).toBe('running');
    expect(ctx.sentPrompts.some((p) => p.prompt.includes('Root cause is off-by-one.'))).toBe(true);

    // Post board @mention
    const boardMsg = await ctx.service.postBoardMessage({ teamId: team.id, author: 'user', body: 'Status check @Reviewer' });
    expect(boardMsg.mentions).toEqual([team.members.find((m) => m.role === 'reviewer').id]);
    expect(ctx.sentPrompts.some((p) => p.prompt.includes('Status check @Reviewer'))).toBe(true);

    // Connected chat links
    const link = await ctx.service.linkSessions({
      sourceSessionId: team.members[0].sessionId,
      targetSessionId: team.members[1].sessionId,
      relation: 'supervise',
      note: 'Watch progress',
    });
    expect((await ctx.service.listLinks(team.members[0].sessionId))).toHaveLength(1);
    await ctx.service.unlinkSessions(link.id);
    expect((await ctx.service.listLinks(team.members[0].sessionId))).toHaveLength(0);
  });

  it('serves authorized Express endpoints and rejects cyclic DAGs with 400', async () => {
    const ctx = await setupTeams();
    const app = express();
    registerTeamsRoutes(app, { service: ctx.service, requireAuthorized: async () => true });

    const created = await request(app)
      .post('/api/teams')
      .send({ name: 'API Team', directory: 'C:/repo', preset: 'custom' })
      .expect(201);
    const teamId = created.body.id;

    await request(app)
      .post(`/api/teams/${teamId}/tasks`)
      .send({ id: 'self', title: 'Cycle', dependsOn: ['self'] })
      .expect(400);

    const t1 = await request(app)
      .post(`/api/teams/${teamId}/tasks`)
      .send({ id: 't_ok', title: 'Run tests' })
      .expect(201);
    expect(t1.body.status).toBe('running');

    await request(app).post(`/api/teams/${teamId}/tasks/t_ok/cancel`).expect(200);
    await request(app).post(`/api/teams/${teamId}/stop`).expect(200);
    const after = await request(app).get(`/api/teams/${teamId}`).expect(200);
    expect(after.body.status).toBe('stopped');
  });

  it('aborts running sessions on cancel, propagates blocked dependencies to @lead, and unblocks on retry', async () => {
    const ctx = await setupTeams();
    const team = await ctx.service.createTeam({
      name: 'Supervisor Team',
      goal: 'Ship safely',
      directory: 'C:/repo',
      preset: 'bug-hunt',
      initialTasks: [
        { id: 't1', title: 'Step 1', assignee: 'investigator', prompt: 'Investigate' },
        { id: 't2', title: 'Step 2', assignee: 'fixer', dependsOn: ['t1'], prompt: 'Fix' },
      ],
    });

    await ctx.service.cancelTask(team.id, 't1');
    const afterCancel = await ctx.service.getTeam(team.id);
    expect(afterCancel.tasks.find((t) => t.id === 't1').status).toBe('cancelled');
    expect(afterCancel.tasks.find((t) => t.id === 't2').status).toBe('blocked');
    expect(afterCancel.messages.some((m) => m.body.includes('@lead') && m.body.includes('t2'))).toBe(true);
    expect(afterCancel.status).toBe('failed');

    // Retrying t1 unblocks t2 back to pending and reactivates the team
    await ctx.service.retryTask(team.id, 't1');
    const afterRetry = await ctx.service.getTeam(team.id);
    expect(afterRetry.status).toBe('active');
    expect(afterRetry.tasks.find((t) => t.id === 't1').status).toBe('running');
    expect(afterRetry.tasks.find((t) => t.id === 't2').status).toBe('pending');
  });
});
