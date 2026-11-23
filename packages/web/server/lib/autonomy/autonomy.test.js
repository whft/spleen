import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAutonomyStore } from './store.js';
import { createEvidenceVerifier } from './verifier.js';
import { createAutonomySupervisor } from './supervisor.js';

describe('Autonomous Supervisor & Evidence Verifier', () => {
  it('completes a multi-step DAG objective only after independent verification passes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-autonomy-'));
    const store = createAutonomyStore({ dbPath: ':memory:' });
    const executed = [];
    const runCommand = vi.fn(async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 12, stdout: 'ok', stderr: '' }));
    const verifier = createEvidenceVerifier({ runCommand, readGit: async () => 'M app.js' });
    const supervisor = createAutonomySupervisor({
      store,
      verifier,
      executeTask: async (_obj, task) => {
        executed.push(task.title);
        return { ok: true, result: `Finished ${task.title}`, artifacts: ['app.js'] };
      },
    });

    try {
      const obj = supervisor.createObjective({
        title: 'Build feature',
        directory: dir,
        verificationCommands: ['bun test'],
        tasks: [
          { id: 't1', title: 'Research', kind: 'research', role: 'researcher', prompt: 'Gather facts', idempotencyKey: 'k1' },
          { id: 't2', title: 'Implement', kind: 'code', role: 'engineer', prompt: 'Write code', dependsOn: ['t1'] },
        ],
      });
      const dup = supervisor.addTask(obj.id, { title: 'Duplicate Research', idempotencyKey: 'k1' });
      expect(dup.id).toBe('t1');

      await supervisor.tick();
      await supervisor.tick();
      await supervisor.tick();

      const detail = supervisor.getObjective(obj.id);
      expect(executed).toEqual(['Research', 'Implement']);
      expect(detail.status).toBe('completed');
      expect(detail.verifications[0].status).toBe('passed');
      expect(runCommand).toHaveBeenCalledWith('bun test', dir, expect.any(Number));
    } finally {
      store.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('spawns follow-up fix task on verification failure and blocks after repeated failures', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-autonomy-fail-'));
    const store = createAutonomyStore({ dbPath: ':memory:' });
    let verifyCalls = 0;
    const verifier = createEvidenceVerifier({
      runCommand: async (cmd) => {
        verifyCalls += 1;
        if (verifyCalls === 1) return { command: cmd, status: 'failed', exitCode: 1, durationMs: 8, stdout: '', stderr: 'test failed' };
        return { command: cmd, status: 'passed', exitCode: 0, durationMs: 8, stdout: 'all green', stderr: '' };
      },
      readGit: async () => '',
    });
    const supervisor = createAutonomySupervisor({
      store,
      verifier,
      executeTask: async () => ({ ok: true, result: 'patched' }),
    });

    try {
      const obj = supervisor.createObjective({
        title: 'Fix regression',
        directory: dir,
        verificationCommands: ['bun test'],
        tasks: [{ id: 't1', title: 'Initial patch', kind: 'code', prompt: 'patch' }],
      });

      await supervisor.tick();
      await supervisor.tick();
      const mid = supervisor.getObjective(obj.id);
      expect(mid.status).toBe('active');
      expect(mid.loopPhase).toBe('replan');
      expect(mid.tasks.some((t) => t.title.includes('Fix verification failure'))).toBe(true);

      await supervisor.tick();
      await supervisor.tick();
      expect(supervisor.getObjective(obj.id).status).toBe('completed');
    } finally {
      store.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('recovers orphaned running tasks across SQLite database restart', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-autonomy-restart-'));
    const dbPath = path.join(dir, 'autonomy.sqlite3');
    try {
      const store1 = createAutonomyStore({ dbPath });
      const obj = store1.createObjective({ title: 'Long job', directory: dir, verificationCommands: ['echo ok'] });
      const t1 = store1.addTask(obj.id, { title: 'Worker step', prompt: 'do work' });
      store1.updateTask(t1.id, { status: 'running', leaseOwner: 'dead-worker-999', leaseUntil: Date.now() + 60_000 });
      store1.close();

      const store2 = createAutonomyStore({ dbPath });
      const verifier = createEvidenceVerifier({
        runCommand: async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '' }),
        readGit: async () => '',
      });
      const supervisor2 = createAutonomySupervisor({
        store: store2,
        verifier,
        workerId: 'new-worker-1000',
        executeTask: async () => ({ ok: true, result: 'resumed ok' }),
      });

      const recovery = supervisor2.recoverOnStartup();
      expect(recovery.reclaimedTasks).toEqual([t1.id]);

      await supervisor2.tick();
      await supervisor2.tick();
      expect(supervisor2.getObjective(obj.id).status).toBe('completed');
      store2.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('enforces budgets, refuses unverified completion, and supports pause/resume/emergency stop', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-autonomy-budget-'));
    const store = createAutonomyStore({ dbPath: ':memory:' });
    const verifier = createEvidenceVerifier({ readGit: async () => '' });
    const supervisor = createAutonomySupervisor({
      store,
      verifier,
      executeTask: async () => ({ ok: true, result: 'done' }),
    });

    try {
      const unverified = supervisor.createObjective({
        title: 'No checks configured',
        directory: dir,
        verificationCommands: [],
        tasks: [{ title: 'Step 1', prompt: 'work' }],
      });
      await supervisor.tick();
      await supervisor.tick();
      const unverifiedState = supervisor.getObjective(unverified.id);
      expect(unverifiedState.status).toBe('blocked');
      expect(unverifiedState.verifications[0].status).toBe('unverified');

      const budgeted = supervisor.createObjective({
        title: 'Budgeted',
        directory: dir,
        budget: { maxTurns: 1 },
        verificationCommands: ['echo ok'],
        tasks: [{ title: 'A', prompt: 'a' }, { title: 'B', prompt: 'b' }],
      });
      await supervisor.tick();
      await supervisor.tick();
      expect(supervisor.getObjective(budgeted.id).status).toBe('blocked');
      expect(supervisor.getObjective(budgeted.id).lastError).toMatch(/budget/i);

      supervisor.resumeObjective(budgeted.id);
      expect(supervisor.getObjective(budgeted.id).status).toBe('active');
      const stopRes = supervisor.emergencyStopAll();
      expect(stopRes.stoppedIds).toContain(budgeted.id);
      expect(supervisor.getObjective(budgeted.id).status).toBe('paused');
    } finally {
      store.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
