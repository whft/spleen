import { describe, expect, it, vi } from 'vitest';
import {
  createExecutionCoordinator,
  createLaneScheduler,
  createProviderGate,
  isVerifiedZeroCostZenModel,
} from './index.js';

describe('execution-coordinator', () => {
  it('enforces lane concurrency limits without blocking unrelated lanes', async () => {
    const lanes = createLaneScheduler({ limits: { autonomy: 2, interactive: 2 } });
    const l1 = await lanes.acquire('autonomy', { key: 't1' });
    const l2 = await lanes.acquire('autonomy', { key: 't2' });

    let l3Resolved = false;
    const l3Promise = lanes.acquire('autonomy', { key: 't3' }).then((lease) => {
      l3Resolved = true;
      return lease;
    });

    const interactiveLease = await lanes.acquire('interactive', { key: 'u1' });
    expect(interactiveLease.lane).toBe('interactive');
    expect(l3Resolved).toBe(false);
    expect(lanes.snapshot().autonomy).toMatchObject({ limit: 2, active: 2, queued: 1 });

    l1.release();
    const l3 = await l3Promise;
    expect(l3Resolved).toBe(true);
    l2.release();
    l3.release();
    interactiveLease.release();
    expect(lanes.snapshot().autonomy.active).toBe(0);
  });

  it('strictly verifies $0-cost OpenCode Zen models and rejects paid or unknown-cost models', () => {
    expect(isVerifiedZeroCostZenModel({
      providerID: 'opencode',
      id: 'big-pickle',
      modelID: 'big-pickle',
      enabled: true,
      status: 'active',
      cost: [{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
    })).toBe(true);

    expect(isVerifiedZeroCostZenModel({
      providerID: 'opencode',
      id: 'paid-claude',
      modelID: 'paid-claude',
      enabled: true,
      status: 'active',
      cost: [{ input: 3, output: 15 }],
    })).toBe(false);

    expect(isVerifiedZeroCostZenModel({
      providerID: 'opencode',
      id: 'mystery-model',
      modelID: 'mystery-model',
      enabled: true,
      status: 'active',
      cost: [],
    })).toBe(false);

    expect(isVerifiedZeroCostZenModel({
      providerID: 'anthropic',
      id: 'claude-free',
      modelID: 'claude-free',
      enabled: true,
      status: 'active',
      cost: [{ input: 0, output: 0 }],
    })).toBe(false);
  });

  it('selects free Zen failover models, tracks cooldowns, and restores primary model after reset', async () => {
    let clock = 1_000_000;
    const gate = createProviderGate({
      now: () => clock,
      readSettings: async () => ({ freeZenFailoverEnabled: true }),
      readModelCatalog: async () => [
        {
          providerID: 'opencode',
          id: 'big-pickle',
          modelID: 'big-pickle',
          name: 'Big Pickle',
          enabled: true,
          status: 'active',
          limit: { context: 200_000, output: 16_000 },
          cost: [{ input: 0, output: 0 }],
        },
        {
          providerID: 'opencode',
          id: 'zen-paid-pro',
          modelID: 'zen-paid-pro',
          name: 'Zen Paid Pro',
          enabled: true,
          status: 'active',
          limit: { context: 500_000, output: 32_000 },
          cost: [{ input: 2.5, output: 10 }],
        },
        {
          providerID: 'opencode',
          id: 'grok-code-fast-free',
          modelID: 'grok-code-fast-free',
          name: 'Grok Code Fast Free',
          enabled: true,
          status: 'active',
          limit: { context: 128_000, output: 16_000 },
          cost: [{ input: 0, output: 0 }],
        },
      ],
    });

    const failover = await gate.selectFailoverModel({
      sessionID: 'ses_test_1',
      providerID: 'opencode',
      modelID: 'big-pickle',
      error: { type: 'provider.free-limit', message: 'Free usage limit reached, try again in 5 minutes' },
    });

    expect(failover).toMatchObject({
      kind: 'free-zen-pool',
      verifiedZeroCost: true,
      model: { providerID: 'opencode', id: 'grok-code-fast-free' },
    });
    expect(gate.getCooldown({ providerID: 'opencode', modelID: 'big-pickle' }).blocked).toBe(true);
    expect(gate.getRestorableModel('ses_test_1')).toBeNull();

    clock += 6 * 60_000;
    expect(gate.getCooldown({ providerID: 'opencode', modelID: 'big-pickle' }).blocked).toBe(false);
    expect(gate.getRestorableModel('ses_test_1')).toEqual({
      providerID: 'opencode',
      id: 'big-pickle',
    });
    gate.close();
  });

  it('prevents competing dispatchers, respects user queue and recovery priority, and fences interrupted epochs', async () => {
    let clock = 50_000;
    let queueHasItems = false;
    let recoveryState = null;
    const abortedSessions = [];

    const coordinator = createExecutionCoordinator({
      now: () => clock,
      hasQueuedUserMessages: () => queueHasItems,
      getRecoverySessionState: () => recoveryState,
      listChildSessions: async () => ['ses_child_1'],
      abortOpenCodeSession: async (sid) => {
        abortedSessions.push(sid);
        return true;
      },
    });

    const releaseAutonomy = coordinator.claimController('ses_main', 'autonomy', { objectiveId: 'obj_1' });
    expect(coordinator.getArbitration('ses_main', 'session-goal')).toMatchObject({
      allowed: false,
      reason: 'owned_by_supervisor',
      holder: 'autonomy',
    });

    queueHasItems = true;
    expect(coordinator.getArbitration('ses_main', 'autonomy')).toMatchObject({
      allowed: false,
      reason: 'user_queue_pending',
      holder: 'queue',
    });
    queueHasItems = false;

    recoveryState = { state: 'waiting_provider', nextWakeAt: clock + 120_000 };
    const skipped = await coordinator.runExclusive('ses_main', { owner: 'autonomy' }, async () => 'should-not-run');
    expect(skipped).toMatchObject({
      dispatched: false,
      skipped: true,
      reason: 'waiting_provider',
      holder: 'recovery',
      nextWakeAt: clock + 120_000,
    });
    recoveryState = null;

    let observedCurrentBeforeInterrupt = false;
    let observedCurrentAfterInterrupt = true;
    let triggerInterrupt;
    const gatePromise = new Promise((resolve) => { triggerInterrupt = resolve; });

    const runPromise = coordinator.runExclusive('ses_main', { owner: 'autonomy' }, async ({ isCurrentEpoch }) => {
      observedCurrentBeforeInterrupt = isCurrentEpoch();
      triggerInterrupt();
      await Promise.resolve();
      await Promise.resolve();
      observedCurrentAfterInterrupt = isCurrentEpoch();
      return 'done';
    });

    await gatePromise;
    const interruptRes = await coordinator.interruptSession('ses_main', { reason: 'user_cancel', includeDescendants: true });
    expect(interruptRes.interrupted).toBe(true);
    expect(abortedSessions).toEqual(['ses_main', 'ses_child_1']);

    const outcome = await runPromise;
    expect(observedCurrentBeforeInterrupt).toBe(true);
    expect(observedCurrentAfterInterrupt).toBe(false);
    expect(outcome.stale).toBe(true);

    releaseAutonomy();
    const goalCheck = vi.fn(() => coordinator.getArbitration('ses_main', 'session-goal'));
    expect(goalCheck().allowed).toBe(true);
  });
});
