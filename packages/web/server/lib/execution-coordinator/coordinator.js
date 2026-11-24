import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { createLaneScheduler } from './lanes.js';

const OWNER_PRIORITY = Object.freeze({
  interactive: 100,
  queue: 95,
  recovery: 90,
  autonomy: 70,
  team: 70,
  scheduled: 65,
  'session-goal': 60,
});

export const createExecutionCoordinator = ({
  lanes = null,
  providerGate = null,
  hasQueuedUserMessages = () => false,
  getRecoverySessionState = () => null,
  abortOpenCodeSession = null,
  listChildSessions = null,
  broadcastEvent = null,
  now = () => Date.now(),
} = {}) => {
  const laneScheduler = lanes || createLaneScheduler();
  const sessions = new Map();
  const wakeListeners = new Set();

  const ensureSession = (sessionId) => {
    const clean = asNonEmptyString(sessionId);
    if (!clean) throw new Error('sessionId is required');
    let state = sessions.get(clean);
    if (!state) {
      state = {
        sessionId: clean,
        epoch: 0,
        owner: null,
        ownerRef: null,
        directory: '',
        busy: false,
        abortController: null,
        mailboxTail: Promise.resolve(),
        parkedLimit: null,
        controllers: new Map(),
        updatedAt: now(),
      };
      sessions.set(clean, state);
    }
    return state;
  };

  const emit = (type, properties) => {
    if (!broadcastEvent) return;
    try {
      broadcastEvent({ type, properties: { ...properties, timestamp: now() } });
    } catch {}
  };

  const notifyWake = (payload) => {
    for (const fn of wakeListeners) {
      try { fn(payload); } catch {}
    }
  };

  const subscribeWake = (listener) => {
    wakeListeners.add(listener);
    return () => wakeListeners.delete(listener);
  };

  const claimController = (sessionId, controllerKind, ref = null) => {
    const clean = asNonEmptyString(sessionId);
    const kind = asNonEmptyString(controllerKind);
    if (!clean || !kind) return () => {};
    const state = ensureSession(clean);
    state.controllers.set(kind, { ref, claimedAt: now() });
    state.updatedAt = now();
    return () => {
      const current = sessions.get(clean);
      if (!current) return;
      current.controllers.delete(kind);
      current.updatedAt = now();
      notifyWake({ sessionId: clean, reason: 'controller_released', controllerKind: kind });
    };
  };

  const getArbitration = (sessionId, requesterKind, { at = now() } = {}) => {
    const clean = asNonEmptyString(sessionId);
    if (!clean) return { allowed: false, reason: 'invalid_session' };
    const kind = asNonEmptyString(requesterKind) || 'autonomy';
    const state = sessions.get(clean);

    if (kind !== 'interactive' && kind !== 'queue' && Boolean(hasQueuedUserMessages(clean))) {
      return { allowed: false, reason: 'user_queue_pending', holder: 'queue' };
    }

    const recoveryState = getRecoverySessionState(clean);
    const recoveryStatus = asNonEmptyString(recoveryState?.state);
    if (kind !== 'recovery' && kind !== 'interactive') {
      if (recoveryStatus === 'waiting_provider' || recoveryStatus === 'recovering' || recoveryStatus === 'waiting_parent') {
        return {
          allowed: false,
          reason: recoveryStatus === 'waiting_provider' ? 'waiting_provider' : 'recovery_active',
          holder: 'recovery',
          nextWakeAt: Number(recoveryState?.nextWakeAt ?? recoveryState?.next_wake_at) || state?.parkedLimit?.resetAt || null,
        };
      }
      if (state?.parkedLimit && state.parkedLimit.resetAt > at) {
        return {
          allowed: false,
          reason: 'waiting_provider',
          holder: 'recovery',
          nextWakeAt: state.parkedLimit.resetAt,
        };
      }
    }

    if (state?.busy && state.owner && state.owner !== kind) {
      return { allowed: false, reason: 'session_busy', holder: state.owner, epoch: state.epoch };
    }

    if (kind === 'session-goal' && state && (state.controllers.has('autonomy') || state.controllers.has('team'))) {
      const dominant = state.controllers.has('autonomy') ? 'autonomy' : 'team';
      return { allowed: false, reason: 'owned_by_supervisor', holder: dominant };
    }

    return { allowed: true, reason: null, holder: state?.owner ?? null, epoch: state?.epoch ?? 0 };
  };

  const runExclusive = async (sessionId, {
    owner = 'autonomy',
    ownerRef = null,
    lane = owner,
    directory = '',
    priority = OWNER_PRIORITY[owner] ?? 50,
    signal = null,
  } = {}, work) => {
    const state = ensureSession(sessionId);
    const runTask = async () => {
      const check = getArbitration(state.sessionId, owner);
      if (!check.allowed) {
        return {
          dispatched: false,
          skipped: true,
          reason: check.reason,
          holder: check.holder ?? null,
          nextWakeAt: check.nextWakeAt ?? null,
          epoch: state.epoch,
        };
      }

      const abortController = new AbortController();
      const onParentAbort = () => abortController.abort();
      if (signal) {
        if (signal.aborted) abortController.abort();
        else signal.addEventListener('abort', onParentAbort, { once: true });
      }

      const lease = lane && lane !== 'none'
        ? await laneScheduler.acquire(lane, { key: `${owner}:${state.sessionId}`, priority, signal: abortController.signal })
        : { release: () => {} };

      state.epoch += 1;
      const runEpoch = state.epoch;
      state.owner = owner;
      state.ownerRef = ownerRef;
      if (asNonEmptyString(directory)) state.directory = directory;
      state.busy = true;
      state.abortController = abortController;
      state.updatedAt = now();

      try {
        const result = await work({
          sessionId: state.sessionId,
          epoch: runEpoch,
          signal: abortController.signal,
          isCurrentEpoch: () => state.epoch === runEpoch && !abortController.signal.aborted,
        });
        return {
          dispatched: true,
          skipped: false,
          epoch: runEpoch,
          stale: state.epoch !== runEpoch,
          result,
        };
      } finally {
        if (signal) signal.removeEventListener('abort', onParentAbort);
        if (state.epoch === runEpoch) {
          state.busy = false;
          state.owner = null;
          state.ownerRef = null;
          state.abortController = null;
          state.updatedAt = now();
        }
        lease.release();
        notifyWake({ sessionId: state.sessionId, reason: 'turn_released', owner, epoch: runEpoch });
      }
    };

    const chained = state.mailboxTail.then(runTask, runTask);
    state.mailboxTail = chained.then(() => undefined, () => undefined);
    return chained;
  };

  const interruptSession = async (sessionId, {
    directory = '',
    reason = 'interrupted',
    includeDescendants = true,
  } = {}) => {
    const clean = asNonEmptyString(sessionId);
    if (!clean) return { interrupted: false, epoch: 0, abortedChildren: [] };
    const state = ensureSession(clean);
    state.epoch += 1;
    const nextEpoch = state.epoch;
    state.busy = false;
    state.owner = null;
    state.ownerRef = null;
    state.parkedLimit = null;
    state.updatedAt = now();
    if (state.abortController) {
      try { state.abortController.abort(); } catch {}
      state.abortController = null;
    }

    const dir = asNonEmptyString(directory) || state.directory || '';
    let interrupted = false;
    if (abortOpenCodeSession) {
      interrupted = await Promise.resolve(abortOpenCodeSession(clean, dir)).catch(() => false);
    }

    const abortedChildren = [];
    if (includeDescendants && listChildSessions && abortOpenCodeSession) {
      const children = await Promise.resolve(listChildSessions(clean, dir)).catch(() => []);
      for (const childId of Array.isArray(children) ? children : []) {
        const cleanChild = asNonEmptyString(childId);
        if (!cleanChild || cleanChild === clean) continue;
        const childState = sessions.get(cleanChild);
        if (childState) {
          childState.epoch += 1;
          childState.busy = false;
          childState.abortController?.abort();
          childState.abortController = null;
        }
        const ok = await Promise.resolve(abortOpenCodeSession(cleanChild, dir)).catch(() => false);
        if (ok) abortedChildren.push(cleanChild);
      }
    }

    emit('spleen:session-interrupted', { sessionId: clean, epoch: nextEpoch, reason, abortedChildren });
    notifyWake({ sessionId: clean, reason: 'interrupted', epoch: nextEpoch });
    return { interrupted, epoch: nextEpoch, abortedChildren };
  };

  const noteLimitParked = ({
    sessionId,
    providerID = '',
    modelID = '',
    credentialID = '',
    error = null,
    resetAt = null,
    reason = 'provider limit',
    at = now(),
  } = {}) => {
    const clean = asNonEmptyString(sessionId);
    const gateRecord = providerGate
      ? providerGate.recordLimit({ providerID, modelID, credentialID, error, resetAt, at })
      : null;
    const effectiveResetAt = Number(resetAt) > at ? Number(resetAt) : (gateRecord?.resetAt ?? (at + 15_000));
    if (clean) {
      const state = ensureSession(clean);
      state.parkedLimit = {
        providerID: gateRecord?.providerID || providerID || 'opencode',
        modelID: modelID || null,
        resetAt: effectiveResetAt,
        reason: asNonEmptyString(reason) || gateRecord?.reason || 'provider limit',
        parkedAt: at,
      };
      state.updatedAt = at;
    }
    notifyWake({ sessionId: clean, reason: 'limit_parked', resetAt: effectiveResetAt });
    return { resetAt: effectiveResetAt, gateRecord };
  };

  const noteLimitResumed = ({ sessionId, at = now() } = {}) => {
    const clean = asNonEmptyString(sessionId);
    if (!clean) return;
    const state = sessions.get(clean);
    if (state) {
      state.parkedLimit = null;
      state.updatedAt = at;
    }
    notifyWake({ sessionId: clean, reason: 'limit_resumed', at });
  };

  const getSessionFence = (sessionId) => {
    const clean = asNonEmptyString(sessionId);
    if (!clean) return null;
    const state = sessions.get(clean);
    if (!state) return { sessionId: clean, epoch: 0, busy: false, owner: null, parkedLimit: null, controllers: [] };
    if (state.parkedLimit && state.parkedLimit.resetAt <= now()) {
      state.parkedLimit = null;
    }
    return {
      sessionId: state.sessionId,
      epoch: state.epoch,
      busy: state.busy,
      owner: state.owner,
      ownerRef: state.ownerRef,
      parkedLimit: state.parkedLimit,
      controllers: [...state.controllers.keys()],
    };
  };

  const getStatus = () => {
    const at = now();
    const activeSessions = [];
    const parkedSessions = [];
    for (const state of sessions.values()) {
      if (state.parkedLimit && state.parkedLimit.resetAt <= at) {
        state.parkedLimit = null;
      }
      if (state.busy) {
        activeSessions.push({
          sessionId: state.sessionId,
          owner: state.owner,
          epoch: state.epoch,
          controllers: [...state.controllers.keys()],
        });
      }
      if (state.parkedLimit) {
        parkedSessions.push({
          sessionId: state.sessionId,
          ...state.parkedLimit,
        });
      }
    }
    return {
      lanes: laneScheduler.snapshot(),
      activeSessions,
      parkedSessions,
      cooldowns: providerGate ? providerGate.listCooldowns(at) : [],
      activeFailovers: providerGate ? providerGate.listActiveFailovers() : [],
    };
  };

  return {
    lanes: laneScheduler,
    providerGate,
    claimController,
    getArbitration,
    runExclusive,
    interruptSession,
    noteLimitParked,
    noteLimitResumed,
    getSessionFence,
    subscribeWake,
    getStatus,
    isRecordPresent: (v) => isRecord(v),
  };
};
