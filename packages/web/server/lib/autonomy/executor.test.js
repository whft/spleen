import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createAutonomyStore } from './store.js';
import { createEvidenceVerifier } from './verifier.js';
import { createAutonomySupervisor } from './supervisor.js';
import { createAutonomySessionExecutor, createOpenCodeSessionAdapter } from './executor.js';
import { bootstrapAutonomyPlatform } from './bootstrap.js';

const tempDirs = [];

const createTempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('autonomy live session executor', () => {
  it('drives an attached existing session without creating extra chats and auto-seeds starter task', async () => {
    const workDir = createTempDir('spleen-exec-attached-');
    const store = createAutonomyStore({ dbPath: ':memory:' });
    const sent = [];
    let createdCount = 0;
    let assistantTs = 100;
    let statusCalls = 0;

    const sessionService = {
      create: async () => {
        createdCount += 1;
        return { sessionId: `ses_new_${createdCount}` };
      },
      send: async (sessionId, payload) => {
        sent.push({ sessionId, ...payload });
        assistantTs = 500;
        statusCalls = 0;
        return { promptDispatched: true };
      },
    };

    const executor = createAutonomySessionExecutor({
      store,
      sessionService,
      readSessionStatus: async () => {
        statusCalls += 1;
        return statusCalls === 1 ? { type: 'busy' } : { type: 'idle' };
      },
      readLastAssistantMessage: async () => ({
        completedAt: assistantTs,
        text: 'Researched and verified all findings.',
        failed: false,
        error: null,
      }),
      wait: async () => {},
    });

    const verifier = createEvidenceVerifier({
      runCommand: async () => ({ command: 'check', status: 'passed', exitCode: 0, durationMs: 5, stdout: 'ok', stderr: '' }),
      readGit: async () => '',
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier,
      executeTask: executor.executeTask,
    });

    const obj = supervisor.createObjective({
      title: 'Continue deep research',
      directory: workDir,
      sessionId: 'ses_existing_target',
      verificationCommands: ['check'],
    });

    expect(obj.tasks.length).toBe(1);
    expect(obj.sessionId).toBe('ses_existing_target');

    await supervisor.tick();
    await supervisor.tick();

    expect(createdCount).toBe(0);
    expect(sent.length).toBe(1);
    expect(sent[0].sessionId).toBe('ses_existing_target');
    const done = supervisor.getObjective(obj.id);
    expect(done.status).toBe('completed');
    expect(done.tasks[0].result).toContain('Researched and verified');
    store.close();
  });

  it('auto-creates a single dedicated session when no sessionId is attached', async () => {
    const workDir = createTempDir('spleen-exec-auto-');
    const store = createAutonomyStore({ dbPath: ':memory:' });
    const sent = [];
    let createdCount = 0;
    let turnTs = 0;

    const executor = createAutonomySessionExecutor({
      store,
      sessionService: {
        create: async () => {
          createdCount += 1;
          return { sessionId: `ses_auto_${createdCount}` };
        },
        send: async (sessionId, payload) => {
          sent.push({ sessionId, ...payload });
          turnTs += 100;
          return { promptDispatched: true };
        },
      },
      readSessionStatus: async () => ({ type: 'idle' }),
      readLastAssistantMessage: async () => ({ completedAt: turnTs, text: 'Step ok', failed: false, error: null }),
      wait: async () => {},
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({
        runCommand: async () => ({ command: 'ok', status: 'passed', exitCode: 0, durationMs: 1, stdout: '', stderr: '' }),
        readGit: async () => '',
      }),
      executeTask: executor.executeTask,
    });

    const obj = supervisor.createObjective({
      title: 'Auto session task',
      directory: workDir,
      verificationCommands: ['ok'],
    });
    await supervisor.tick();

    expect(createdCount).toBe(1);
    expect(sent[0].sessionId).toBe('ses_auto_1');
    expect(supervisor.getObjective(obj.id).sessionId).toBe('ses_auto_1');
    store.close();
  });

  it('defaults autonomy.create from handleControlAction to the calling chat sessionId', async () => {
    const dataDir = createTempDir('spleen-exec-ctx-data-');
    const workDir = createTempDir('spleen-exec-ctx-work-');
    const app = express();
    app.use(express.json());
    const platform = bootstrapAutonomyPlatform(app, { dataDir, autoStart: false });

    const created = await platform.handleControlAction(
      'autonomy.create',
      { title: 'Keep researching in this chat', mode: 'ongoing', runImmediately: false },
      { contextDirectory: workDir, contextSessionId: 'ses_caller_chat_42' },
    );
    expect(created.sessionId).toBe('ses_caller_chat_42');
    expect(created.directory).toBe(workDir);
    expect(created.tasks.length).toBe(1);

    const switched = await platform.handleControlAction(
      'autonomy.attachSession',
      { objectiveId: created.id, sessionId: 'ses_other_99' },
      { contextDirectory: workDir, contextSessionId: 'ses_caller_chat_42' },
    );
    expect(switched.sessionId).toBe('ses_other_99');
    platform.stop();
  });

  it('continues ongoing research without verification commands and recovers on resume/continue after failure', async () => {
    const workDir = createTempDir('spleen-exec-ongoing-');
    let clock = 10_000;
    const store = createAutonomyStore({ dbPath: ':memory:', now: () => clock });
    const sent = [];
    let turnTs = 0;
    let shouldFail = false;

    const executor = createAutonomySessionExecutor({
      store,
      sessionService: {
        send: async (sessionId, payload) => {
          sent.push({ sessionId, ...payload });
          if (shouldFail) return { promptDispatched: false, promptError: 'Transient rate limit' };
          turnTs += 100;
          return { promptDispatched: true };
        },
      },
      readSessionStatus: async () => ({ type: 'idle' }),
      readLastAssistantMessage: async () => ({ completedAt: turnTs, text: `Research wave ${sent.length} complete.`, failed: false, error: null }),
      now: () => clock,
      wait: async () => {},
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({ readGit: async () => '' }),
      executeTask: executor.executeTask,
      now: () => clock,
    });

    const obj = supervisor.createObjective({
      title: 'Continuous research',
      directory: workDir,
      sessionId: 'ses_research_1',
      mode: 'ongoing',
      budget: { reviewIntervalMs: 15_000, maxTurns: 10 },
    });

    await supervisor.tick();
    await supervisor.tick();
    const waitingState = supervisor.getObjective(obj.id);
    expect(waitingState.status).toBe('waiting');
    expect(waitingState.lastError).toBeNull();

    clock += 16_000;
    await supervisor.tick();
    expect(sent.length).toBe(2);
    expect(sent[1].prompt).toContain('Research wave 1 complete.');

    shouldFail = true;
    supervisor.continueObjective(obj.id, 'Investigate next routine');
    await supervisor.tick();
    shouldFail = false;
    supervisor.resumeObjective(obj.id);
    clock += 60_000;
    await supervisor.tick();
    expect(sent.length).toBe(4);
    expect(supervisor.getObjective(obj.id).tasks.some((t) => t.status === 'completed' && t.result?.includes('Research wave 4'))).toBe(true);
    store.close();
  });

  it('unwraps /api/session/active data envelope, ignores unfinished streaming messages, and never spawns fix tasks on ongoing research', async () => {
    const adapter = createOpenCodeSessionAdapter({
      readOpenCodeJson: async (urlPath) => {
        if (urlPath === '/api/session/active') {
          return { data: { ses_live: { status: 'running' } } };
        }
        return {
          data: [
            { type: 'assistant', time: { created: 2000 }, content: [{ type: 'text', text: 'partial stream...' }] },
            { type: 'assistant', time: { created: 1000, completed: 1500 }, content: [{ type: 'text', text: 'Real finished reply' }] },
          ],
        };
      },
    });

    expect(await adapter.readSessionStatus('ses_live', '/repo')).toEqual({ type: 'busy' });
    expect(await adapter.readSessionStatus('ses_other', '/repo')).toEqual({ type: 'idle' });
    const latest = await adapter.readLastAssistantMessage('ses_live', '/repo');
    expect(latest.completedAt).toBe(1500);
    expect(latest.text).toBe('Real finished reply');

    const workDir = createTempDir('spleen-exec-ongoing-noscope-');
    const store = createAutonomyStore({ dbPath: ':memory:' });
    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({
        runCommand: async () => ({ command: 'bun test', status: 'failed', exitCode: 1, durationMs: 5, stdout: '', stderr: 'unrelated ref test failed' }),
        readGit: async () => '',
      }),
      executeTask: async () => ({ ok: true, result: 'Research step done' }),
    });

    const obj = supervisor.createObjective({
      title: 'Pure research objective',
      directory: workDir,
      mode: 'ongoing',
      verificationCommands: ['bun test'],
    });
    await supervisor.tick();
    await supervisor.tick();
    const after = supervisor.getObjective(obj.id);
    expect(after.status).toBe('waiting');
    expect(after.tasks.some((t) => t.title.startsWith('Fix verification failure'))).toBe(false);
    store.close();
  });
});
