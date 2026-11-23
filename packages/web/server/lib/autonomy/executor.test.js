import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createAutonomyStore } from './store.js';
import { createEvidenceVerifier } from './verifier.js';
import { createAutonomySupervisor } from './supervisor.js';
import { createAutonomySessionExecutor } from './executor.js';
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
      send: async (payload) => {
        sent.push(payload);
        assistantTs = 500;
        statusCalls = 0;
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
        send: async (payload) => {
          sent.push(payload);
          turnTs += 100;
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
});
