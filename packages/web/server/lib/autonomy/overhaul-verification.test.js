import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutonomyStore } from './store.js';
import { createEvidenceVerifier } from './verifier.js';
import { createAutonomySupervisor } from './supervisor.js';
import { createAutonomySessionExecutor, createOpenCodeSessionAdapter } from './executor.js';
import { createCompactionBridge } from './compaction-bridge.js';
import { createExecutionCoordinator, createProviderGate } from '../execution-coordinator/index.js';
import { createLimitFailoverRuntime } from '../limit-failover/runtime.js';
import { createSessionGoalRuntime } from '../session-goal/runtime.js';

const tempDirs = [];

const makeTempDir = (prefix) => {
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

describe('Autonomous Harness Overhaul — Fault Injection & End-to-End Verification', () => {
  it('executes parallel DAG tasks concurrently and never blocks unrelated objectives', async () => {
    const dirA = makeTempDir('spleen-par-a-');
    const dirB = makeTempDir('spleen-par-b-');
    const store = createAutonomyStore({ dbPath: ':memory:' });
    const verifier = createEvidenceVerifier({
      runCommand: async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 2, stdout: 'ok', stderr: '' }),
      readGit: async () => '',
    });

    const activeTasks = new Set();
    let maxObservedConcurrency = 0;
    const resolvers = new Map();

    const supervisor = createAutonomySupervisor({
      store,
      verifier,
      executeTask: async (_obj, task) => {
        activeTasks.add(task.id);
        if (activeTasks.size > maxObservedConcurrency) {
          maxObservedConcurrency = activeTasks.size;
        }
        if (task.title.startsWith('SlowA')) {
          await new Promise((resolve) => { resolvers.set(task.id, resolve); });
        }
        activeTasks.delete(task.id);
        return { ok: true, result: `Done ${task.title}` };
      },
    });

    const objA = supervisor.createObjective({
      title: 'Objective A Parallel',
      directory: dirA,
      budget: { maxParallel: 3 },
      verificationCommands: ['test-a'],
      tasks: [
        { id: 'a1', title: 'SlowA-1', kind: 'code', prompt: 'p1' },
        { id: 'a2', title: 'SlowA-2', kind: 'code', prompt: 'p2' },
        { id: 'a3', title: 'SlowA-3', kind: 'code', prompt: 'p3' },
      ],
    });

    const tickAPromise = supervisor.tick({ awaitTasks: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolvers.size).toBe(3);
    expect(maxObservedConcurrency).toBe(3);

    const objB = supervisor.createObjective({
      title: 'Objective B Fast Independent',
      directory: dirB,
      verificationCommands: ['test-b'],
      tasks: [{ id: 'b1', title: 'FastB-1', kind: 'code', prompt: 'fast' }],
    });

    await supervisor.tick({ awaitTasks: true });
    await supervisor.tick({ awaitTasks: true });
    expect(supervisor.getObjective(objB.id).status).toBe('completed');
    expect(supervisor.getObjective(objA.id).status).toBe('active');

    for (const resolve of resolvers.values()) resolve();
    await tickAPromise;
    await supervisor.tick({ awaitTasks: true });
    expect(supervisor.getObjective(objA.id).status).toBe('completed');
    store.close();
  });

  it('recovers seamlessly from 429 / provider.free-limit via $0 Zen failover and quota reset without burning retry budget', async () => {
    const dir = makeTempDir('spleen-zen-limit-');
    const instanceDir = makeTempDir('spleen-zen-inst-');
    let clock = 1_000_000;

    const gate = createProviderGate({
      now: () => clock,
      readSettings: async () => ({ freeZenFailoverEnabled: true }),
      readModelCatalog: async () => [
        { providerID: 'opencode', id: 'big-pickle', modelID: 'big-pickle', name: 'Big Pickle', enabled: true, status: 'active', limit: { context: 200_000, output: 16_000 }, cost: [{ input: 0, output: 0 }] },
        { providerID: 'opencode', id: 'paid-sonnet', modelID: 'paid-sonnet', name: 'Paid Sonnet', enabled: true, status: 'active', limit: { context: 200_000, output: 16_000 }, cost: [{ input: 3, output: 15 }] },
        { providerID: 'opencode', id: 'glm-4.7-free', modelID: 'glm-4.7-free', name: 'GLM Free', enabled: true, status: 'active', limit: { context: 128_000, output: 16_000 }, cost: [{ input: 0, output: 0 }] },
      ],
    });

    const failoverRuntime = createLimitFailoverRuntime({
      fsPromises: fs.promises,
      path,
      instanceDir,
      providerGate: gate,
      readSettings: async () => ({ freeZenFailoverEnabled: true }),
      authorizeRequest: () => true,
      now: () => clock,
    });

    const decision1 = await failoverRuntime.decide({
      sessionID: 'ses_zen_1',
      providerID: 'opencode',
      modelID: 'big-pickle',
      error: { type: 'provider.free-limit', status: 429, message: 'Free usage limit reached, resets in 2m', body: null },
      proposed: { retry: false, delay: 0 },
      credentials: [],
    });
    expect(decision1.action).toBe('switch-model');
    expect(decision1.model).toEqual({ providerID: 'opencode', id: 'glm-4.7-free' });

    const coordinator = createExecutionCoordinator({ providerGate: gate, now: () => clock });
    const store = createAutonomyStore({ dbPath: ':memory:', now: () => clock });
    let sendCalls = 0;
    let simulateLimit = true;
    let replyTs = 100;

    const executor = createAutonomySessionExecutor({
      store,
      executionCoordinator: coordinator,
      sessionService: {
        send: async () => {
          sendCalls += 1;
          replyTs += 50;
          return { promptDispatched: true };
        },
      },
      readSessionStatus: async () => ({ type: 'idle' }),
      readLastAssistantMessage: async () => (
        simulateLimit
          ? {
            id: `msg_${sendCalls}`,
            completedAt: replyTs,
            text: '',
            failed: true,
            isLimit: true,
            rawError: { type: 'provider.free-limit', status: 429, message: 'Free usage limit reached, try again in 30s' },
            providerID: 'opencode',
            modelID: 'glm-4.7-free',
            error: 'Free usage limit reached, try again in 30s',
          }
          : {
            id: `msg_${sendCalls}`,
            completedAt: replyTs,
            text: 'Completed after quota replenished!',
            failed: false,
            isLimit: false,
            error: null,
          }
      ),
      now: () => clock,
      wait: async () => {},
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({
        runCommand: async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '' }),
        readGit: async () => '',
      }),
      executeTask: executor.executeTask,
      executionCoordinator: coordinator,
      now: () => clock,
    });

    const obj = supervisor.createObjective({
      title: 'Zen Free Limit Recovery Test',
      directory: dir,
      sessionId: 'ses_zen_1',
      verificationCommands: ['verify-ok'],
      tasks: [{ id: 'tz1', title: 'Implement feature', prompt: 'build it', maxAttempts: 2 }],
    });

    await supervisor.tick();
    const parkedObj = supervisor.getObjective(obj.id);
    expect(parkedObj.status).toBe('active');
    expect(parkedObj.waitingReason).toBe('waiting_provider');
    expect(parkedObj.failureStreak).toBe(0);
    expect(parkedObj.turnsUsed).toBe(0);
    expect(parkedObj.tasks[0].status).toBe('pending');
    expect(parkedObj.tasks[0].attempts).toBe(0);
    expect(parkedObj.tasks[0].providerWaits).toBe(1);

    clock += 35_000;
    coordinator.noteLimitResumed({ sessionId: 'ses_zen_1', at: clock });
    simulateLimit = false;

    await supervisor.tick();
    await supervisor.tick();
    const finished = supervisor.getObjective(obj.id);
    expect(finished.status).toBe('completed');
    expect(finished.tasks[0].attempts).toBe(1);
    expect(finished.tasks[0].result).toContain('Completed after quota replenished');

    store.close();
    gate.close();
  });

  it('refuses unconfirmed completions and preserves state when OpenCode backend is temporarily unreachable', async () => {
    const dir = makeTempDir('spleen-unconfirmed-');
    let clock = 50_000;
    const store = createAutonomyStore({ dbPath: ':memory:', now: () => clock });
    let mode = 'backend_down';
    let lastCompletedMsg = { id: 'msg_old', completedAt: 100, text: 'Old turn before dispatch', failed: false, error: null };

    const executor = createAutonomySessionExecutor({
      store,
      pollIntervalMs: 1_000,
      unavailableGraceMs: 3_000,
      sessionService: {
        send: async () => {
          if (mode === 'confirmed') {
            lastCompletedMsg = { id: 'msg_new', completedAt: clock + 50, text: 'Confirmed new turn output', failed: false, error: null };
          }
          return { promptDispatched: true };
        },
      },
      readSessionStatus: async () => {
        if (mode === 'backend_down') return null;
        return { type: 'idle' };
      },
      readLastAssistantMessage: async () => lastCompletedMsg,
      now: () => clock,
      wait: async (ms) => { clock += ms; },
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({
        runCommand: async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '' }),
        readGit: async () => '',
      }),
      executeTask: executor.executeTask,
      now: () => clock,
    });

    const obj = supervisor.createObjective({
      title: 'Strict Confirmation Test',
      directory: dir,
      sessionId: 'ses_strict',
      verificationCommands: ['ok'],
      tasks: [{ id: 'ts1', title: 'Critical step', prompt: 'run', maxAttempts: 3 }],
    });

    await supervisor.tick();
    const afterDown = supervisor.getObjective(obj.id);
    expect(afterDown.tasks[0].status).toBe('pending');
    expect(afterDown.tasks[0].attempts).toBe(0);
    expect(afterDown.failureStreak).toBe(0);

    clock += 10_000;
    mode = 'unconfirmed_idle';
    await supervisor.tick();
    const afterUnconfirmed = supervisor.getObjective(obj.id);
    expect(afterUnconfirmed.tasks[0].status).toBe('pending');
    expect(afterUnconfirmed.tasks[0].attempts).toBe(1);
    expect(afterUnconfirmed.status).not.toBe('completed');

    clock += 30_000;
    mode = 'confirmed';
    await supervisor.tick();
    await supervisor.tick();
    expect(supervisor.getObjective(obj.id).status).toBe('completed');
    store.close();
  });

  it('renews execution leases during long active runs with subagents, interrupts descendants on cancel, and fences stale completions', async () => {
    const dir = makeTempDir('spleen-lease-fence-');
    let clock = 100_000;
    const store = createAutonomyStore({ dbPath: ':memory:', now: () => clock });
    const aborted = [];
    const coordinator = createExecutionCoordinator({
      now: () => clock,
      listChildSessions: async () => ['ses_subagent_child_1'],
      abortOpenCodeSession: async (sid) => {
        aborted.push(sid);
        return true;
      },
    });

    let pollCount = 0;
    const leaseMs = 60_000;
    const executor = createAutonomySessionExecutor({
      store,
      executionCoordinator: coordinator,
      leaseMs,
      pollIntervalMs: 20_000,
      maxTurnWaitMs: 600_000,
      sessionService: { send: async () => ({ promptDispatched: true }) },
      readSessionStatus: async () => {
        pollCount += 1;
        if (pollCount <= 5) {
          return { type: 'busy', subagentsWorking: true, activeChildren: ['ses_subagent_child_1'] };
        }
        return { type: 'idle' };
      },
      readLastAssistantMessage: async () => ({
        id: 'msg_long_done',
        completedAt: clock,
        text: 'Long subagent run succeeded',
        failed: false,
        error: null,
      }),
      now: () => clock,
      wait: async (ms) => { clock += ms; },
    });

    const supervisor = createAutonomySupervisor({
      store,
      leaseMs,
      verifier: createEvidenceVerifier({
        runCommand: async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '' }),
        readGit: async () => '',
      }),
      executeTask: executor.executeTask,
      executionCoordinator: coordinator,
      now: () => clock,
    });

    const obj1 = supervisor.createObjective({
      title: 'Long Active Subagent Task',
      directory: dir,
      sessionId: 'ses_long_1',
      verificationCommands: ['ok'],
    });
    await supervisor.tick();
    await supervisor.tick();
    expect(clock).toBeGreaterThan(100_000 + leaseMs);
    expect(supervisor.getObjective(obj1.id).status).toBe('completed');

    let finishStaleWorker;
    const staleGate = new Promise((resolve) => { finishStaleWorker = resolve; });
    const supervisor2 = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({ readGit: async () => '' }),
      executionCoordinator: coordinator,
      executeTask: async () => {
        await staleGate;
        return { ok: true, result: 'STALE_RESULT_MUST_BE_DROPPED' };
      },
      now: () => clock,
    });

    const obj2 = supervisor2.createObjective({
      title: 'Cancel Fencing Test',
      directory: dir,
      sessionId: 'ses_parent_cancel',
      verificationCommands: ['ok'],
    });
    const tickPromise = supervisor2.tick();
    await Promise.resolve();
    await Promise.resolve();

    supervisor2.cancelObjective(obj2.id, 'User cancelled mid-run');
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
    expect(aborted).toEqual(['ses_parent_cancel', 'ses_subagent_child_1']);

    finishStaleWorker();
    await tickPromise;

    const cancelledState = supervisor2.getObjective(obj2.id);
    expect(cancelledState.status).toBe('cancelled');
    expect(cancelledState.tasks[0].status).toBe('cancelled');
    expect(cancelledState.tasks[0].result).toBeNull();
    store.close();
  });

  it('runs ongoing objectives past 30 turns without default turn limit and preserves context across compaction', async () => {
    const dir = makeTempDir('spleen-compaction-');
    let clock = 500_000;
    const store = createAutonomyStore({ dbPath: ':memory:', now: () => clock });
    const compactionBridge = createCompactionBridge({ autonomyStore: store, now: () => clock });

    let turnCounter = 0;
    const capturedPrompts = [];
    const executor = createAutonomySessionExecutor({
      store,
      sessionService: {
        send: async (_sid, payload) => {
          turnCounter += 1;
          capturedPrompts.push(payload.prompt);
          return { promptDispatched: true };
        },
      },
      readSessionStatus: async () => ({ type: 'idle' }),
      readLastAssistantMessage: async () => ({
        id: `msg_c_${turnCounter}`,
        completedAt: clock + turnCounter,
        text: `Unique verified discovery #${turnCounter} at address 0x${(turnCounter * 16).toString(16)}`,
        failed: false,
        error: null,
      }),
      now: () => clock,
      wait: async () => {},
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({ readGit: async () => '' }),
      executeTask: executor.executeTask,
      now: () => clock,
    });

    const ongoing = supervisor.createObjective({
      title: 'Multi-Hour Ongoing Research',
      directory: dir,
      sessionId: 'ses_ongoing_compact',
      mode: 'ongoing',
      budget: { reviewIntervalMs: 5_000 },
    });
    expect(ongoing.budget.maxTurns).toBeNull();

    for (let i = 0; i < 30; i += 1) {
      await supervisor.tick();
      await supervisor.tick();
      if (i === 14) {
        clock += 3_000;
        compactionBridge.handleEvent({
          type: 'session.compacted',
          properties: {
            sessionID: 'ses_ongoing_compact',
            summary: 'Compacted first 15 turns: verified subsystem A and B; subsystem C remains.',
          },
        });
      }
      clock += 6_000;
    }

    const detail = supervisor.getObjective(ongoing.id);
    expect(detail.turnsUsed).toBe(30);
    expect(detail.status).toBe('waiting');
    expect(detail.checkpoints.some((c) => c.kind === 'compaction' && c.compactionEpoch === 1)).toBe(true);
    expect(capturedPrompts.slice(15).every((p) => p.includes('Compaction Continuity Anchor (Epoch #1)'))).toBe(true);
    store.close();
  });

  it('isolates concurrent parallel tasks in Git worktrees and propagates completed dependency outputs', async () => {
    const dir = makeTempDir('spleen-worktrees-');
    const store = createAutonomyStore({ dbPath: ':memory:' });
    let createdIdx = 0;
    const movedWorktrees = [];
    const promptsByTask = new Map();

    const executor = createAutonomySessionExecutor({
      store,
      sessionService: {
        create: async ({ title }) => {
          createdIdx += 1;
          return { sessionId: `ses_wt_${createdIdx}`, title, directory: dir };
        },
        moveToWorktree: async (sessionId, payload) => {
          const wtPath = path.join(dir, '.worktrees', payload.worktree.name);
          movedWorktrees.push({ sessionId, wtPath });
          return { worktree: { path: wtPath } };
        },
        send: async (sessionId, payload) => {
          promptsByTask.set(sessionId, payload);
          return { promptDispatched: true };
        },
      },
      wait: async () => {},
    });

    const supervisor = createAutonomySupervisor({
      store,
      verifier: createEvidenceVerifier({
        runCommand: async (cmd) => ({ command: cmd, status: 'passed', exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '' }),
        readGit: async () => '',
      }),
      executeTask: executor.executeTask,
    });

    const obj = supervisor.createObjective({
      title: 'Parallel Worktree Refactor',
      directory: dir,
      useWorktrees: true,
      budget: { maxParallel: 2 },
      verificationCommands: ['verify-wt'],
      tasks: [
        { id: 'w1', title: 'Refactor Auth', kind: 'code', prompt: 'auth' },
        { id: 'w2', title: 'Refactor Storage', kind: 'code', prompt: 'storage' },
        { id: 'w3', title: 'Integrate Modules', kind: 'code', prompt: 'integrate', dependsOn: ['w1', 'w2'] },
      ],
    });

    await supervisor.tick();
    await supervisor.tick();
    await supervisor.tick();

    const finalObj = supervisor.getObjective(obj.id);
    expect(finalObj.status).toBe('completed');
    expect(movedWorktrees).toHaveLength(3);
    expect(finalObj.tasks[0].worktreePath).toContain('.worktrees');
    expect(finalObj.tasks[1].worktreePath).toContain('.worktrees');
    expect(finalObj.tasks[0].worktreePath).not.toBe(finalObj.tasks[1].worktreePath);
    const w3Session = finalObj.tasks.find((t) => t.id === 'w3').sessionId;
    expect(promptsByTask.get(w3Session).prompt).toContain('Completed Dependency Outputs:');
    expect(promptsByTask.get(w3Session).prompt).toContain('Refactor Auth');
    expect(promptsByTask.get(w3Session).prompt).toContain('Refactor Storage');
    store.close();
  });

  it('prevents session-goal from settling as blocked when OpenCode Zen hits a 429 usage limit', async () => {
    const http = await import('node:http');
    let persistedGoal = {
      id: 'goal_zen_1',
      objective: 'Finish autonomous refactor',
      status: 'active',
      statusReason: '',
      turnsUsed: 1,
      tokensUsed: 100,
      tokensBaseline: 0,
      tokensCommitted: 0,
      lastAccountedMessageID: '',
      auditFailStreak: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const notifications = [];

    const mockOpenCode = http.createServer((req, res) => {
      const loc = { directory: '/repo' };
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.startsWith('/api/session/active')) {
        res.end(JSON.stringify({ location: loc, data: {} }));
        return;
      }
      if (req.url?.startsWith('/api/experimental/job')) {
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (req.url?.startsWith('/api/shell')) {
        res.end(JSON.stringify({ location: loc, data: [] }));
        return;
      }
      if (req.url?.includes('/message')) {
        res.end(JSON.stringify({
          location: loc,
          data: {
            cursor: null,
            data: [
              {
                id: 'msg_asst_limit',
                type: 'assistant',
                sessionID: 'ses_goal_zen',
                time: { created: 2_000, completed: 2_100 },
                finish: 'error',
                error: { type: 'provider.free-limit', status: 429, message: 'OpenCode Zen free usage limit reached' },
                tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
                content: [],
              },
              {
                id: 'msg_user_1',
                type: 'user',
                sessionID: 'ses_goal_zen',
                time: { created: 1_500 },
                text: 'Do the refactor',
              },
            ],
          },
        }));
        return;
      }
      if (req.url?.startsWith('/api/session/ses_goal_zen')) {
        res.end(JSON.stringify({ location: loc, data: { id: 'ses_goal_zen', location: loc } }));
        return;
      }
      res.end(JSON.stringify({ location: loc, data: {} }));
    });

    await new Promise((resolve) => mockOpenCode.listen(0, '127.0.0.1', resolve));
    const { port } = mockOpenCode.address();

    const goalRuntime = createSessionGoalRuntime({
      buildOpenCodeUrl: (p) => `http://127.0.0.1:${port}${p}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => ({}),
      isEnabled: () => true,
      idleQuietMs: 10,
      recheckMs: 50_000,
      readSessionMetadata: async () => ({ spleen: { goal: persistedGoal } }),
      persistSessionGoal: async (_sid, _dir, nextGoal) => {
        persistedGoal = nextGoal;
        return true;
      },
      emitGoalNotification: (n) => notifications.push(n),
    });

    try {
      goalRuntime.processPayload({
        type: 'session.status',
        properties: { sessionID: 'ses_goal_zen', status: { type: 'idle' } },
      }, '/repo');

      await vi.waitFor(() => {
        expect(persistedGoal.statusReason).toBe('waiting for provider limit reset');
      });

      expect(persistedGoal.status).toBe('active');
      expect(notifications).toHaveLength(0);
    } finally {
      goalRuntime.stop();
      await new Promise((resolve) => mockOpenCode.close(resolve));
    }
  });
});
