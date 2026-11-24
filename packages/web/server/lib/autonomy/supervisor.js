import { asNonEmptyString, isRecord } from '../shared/guards.js';
import {
  BASE_RETRY_BACKOFF_MS,
  createSupervisorSettlement,
  validateTaskDag,
} from './supervisor-settlement.js';

const DEFAULT_LEASE_MS = 10 * 60_000;

export const LOOP_PHASES = Object.freeze([
  'objective',
  'research',
  'retrieve',
  'plan',
  'experiment',
  'observe',
  'validate',
  'remember',
  'replan',
]);

export const createAutonomySupervisor = ({
  store,
  verifier,
  executeTask = null,
  executionCoordinator = null,
  globalEventHub = null,
  onObjectiveCompleted = null,
  broadcastEvent = null,
  workerId = `supervisor-${process.pid}`,
  tickIntervalMs = 5_000,
  leaseMs = DEFAULT_LEASE_MS,
  now = () => Date.now(),
} = {}) => {
  let timer = null;
  let wakeTimer = null;
  let ticking = false;
  let pendingImmediateTick = false;
  let stopped = false;
  const inFlight = new Map();
  const unsubscribers = [];

  const emit = (type, payload) => {
    if (broadcastEvent) {
      try { broadcastEvent({ type, ...payload, timestamp: now() }); } catch {}
    }
  };

  const clearWakeTimer = () => {
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
  };

  const armWakeTimer = () => {
    clearWakeTimer();
    if (stopped || !timer || store.isClosed?.()) return;
    const at = now();
    let earliest = null;
    const candidates = [
      ...store.listObjectives({ status: 'waiting', limit: 200 }),
      ...store.listObjectives({ status: 'active', limit: 200 }),
    ];
    for (const obj of candidates) {
      for (const ts of [obj.nextReviewAt, obj.waitingUntil]) {
        const n = Number(ts);
        if (Number.isFinite(n) && n > 0 && (earliest === null || n < earliest)) {
          earliest = n;
        }
      }
      if (obj.status === 'active') {
        for (const t of store.listTasks(obj.id)) {
          const r = Number(t.nextRetryAt);
          if (t.status === 'pending' && Number.isFinite(r) && r > 0 && (earliest === null || r < earliest)) {
            earliest = r;
          }
        }
      }
    }
    if (earliest === null) return;
    const delay = Math.max(25, Math.min(tickIntervalMs, earliest - at + 15));
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void tick({ awaitTasks: false });
    }, delay);
    wakeTimer.unref?.();
  };

  const scheduleImmediateTick = () => {
    if (stopped || !timer || store.isClosed?.()) return;
    if (ticking) {
      pendingImmediateTick = true;
      return;
    }
    const immediate = setTimeout(() => { void tick({ awaitTasks: false }); }, 0);
    immediate.unref?.();
  };

  const abortObjectiveExecution = (objectiveId, { reason = 'interrupted' } = {}) => {
    const obj = store.getObjective(objectiveId);
    const sessionsToInterrupt = new Set();
    if (asNonEmptyString(obj?.sessionId)) {
      sessionsToInterrupt.add(obj.sessionId);
    }
    for (const [taskId, active] of inFlight.entries()) {
      if (active.objectiveId !== objectiveId) continue;
      try { active.abortController.abort(); } catch {}
      if (asNonEmptyString(active.sessionId)) sessionsToInterrupt.add(active.sessionId);
      inFlight.delete(taskId);
    }
    for (const t of store.listTasks(objectiveId)) {
      if (asNonEmptyString(t.sessionId) && t.status === 'running') {
        sessionsToInterrupt.add(t.sessionId);
      }
      for (const childId of t.subagentSessionIds || []) {
        if (asNonEmptyString(childId)) sessionsToInterrupt.add(childId);
      }
    }
    if (executionCoordinator) {
      for (const sid of sessionsToInterrupt) {
        void executionCoordinator.interruptSession(sid, {
          directory: obj?.directory || '',
          reason,
          includeDescendants: true,
        }).catch(() => {});
      }
    }
  };

  const getObjectiveDetail = (id) => {
    const objective = store.getObjective(id);
    if (!objective) return null;
    return {
      ...objective,
      tasks: store.listTasks(id),
      decisions: store.listDecisions(id, 50),
      verifications: store.listVerifications(id, 20),
      checkpoints: store.listCheckpoints(id, 40),
    };
  };

  const verifyObjectiveNow = async (objectiveId, { autoDetect = false } = {}) => {
    const obj = store.getObjective(objectiveId);
    if (!obj) throw new Error(`Objective not found: ${objectiveId}`);
    store.updateObjective(objectiveId, { loopPhase: 'validate' });
    const result = await verifier.verifyObjective(obj, { autoDetect });
    const record = store.recordVerification({
      objectiveId,
      status: result.status,
      checks: result.checks,
      gitDiffSummary: result.gitDiffSummary,
      summary: result.summary,
    });
    store.recordDecision({ objectiveId, kind: 'verify', summary: result.summary, details: { status: result.status } });
    emit('autonomy:verified', { objectiveId, status: result.status });
    return { ...result, verification: record };
  };

  const { settleTaskOutcome, evaluateSettledObjective } = createSupervisorSettlement({
    store,
    verifyObjectiveNow,
    onObjectiveCompleted,
    getObjectiveDetail,
    emit,
    armWakeTimer,
    scheduleImmediateTick,
    now,
  });

  const createObjective = (input = {}) => {
    const objective = store.createObjective(input);
    const initialTasks = Array.isArray(input.tasks) && input.tasks.length > 0
      ? input.tasks
      : (input.autoSeedTask === false
        ? []
        : [{
          title: objective.mode === 'ongoing' ? `Research cycle: ${objective.title}` : `Execute objective: ${objective.title}`,
          role: objective.mode === 'ongoing' ? 'researcher' : 'supervisor',
          kind: objective.mode === 'ongoing' ? 'research' : 'code',
          prompt: objective.description,
        }]);
    const createdTasks = [];
    for (const taskSpec of initialTasks) {
      createdTasks.push(store.addTask(objective.id, taskSpec));
    }
    const check = validateTaskDag(createdTasks);
    if (!check.valid) {
      store.updateObjective(objective.id, { status: 'blocked', lastError: check.error });
      throw new Error(check.error);
    }
    store.saveCheckpoint({
      objectiveId: objective.id,
      sessionId: objective.sessionId,
      kind: 'objective_created',
      summary: `Initialized ${objective.mode} objective "${objective.title}"`,
      remaining: createdTasks.map((t) => t.title),
      nextAction: createdTasks[0]?.title || objective.title,
    });
    store.recordDecision({
      objectiveId: objective.id,
      kind: 'plan',
      summary: `Created ${objective.mode} objective with ${createdTasks.length} initial task(s)`,
      details: { taskIds: createdTasks.map((t) => t.id) },
    });
    emit('autonomy:objective_created', { objectiveId: objective.id });
    return getObjectiveDetail(objective.id);
  };

  const addTask = (objectiveId, taskInput = {}) => {
    const obj = store.getObjective(objectiveId);
    if (!obj) throw new Error(`Objective not found: ${objectiveId}`);
    const existing = store.listTasks(objectiveId);
    const created = store.addTask(objectiveId, taskInput);
    const check = validateTaskDag([...existing.filter((t) => t.id !== created.id), created]);
    if (!check.valid) {
      store.updateTask(created.id, { status: 'cancelled', bumpEpoch: true, error: check.error });
      throw new Error(check.error);
    }
    if (obj.status === 'waiting') {
      store.updateObjective(objectiveId, { status: 'active', waitingUntil: null, waitingReason: null });
    }
    store.recordDecision({ objectiveId, taskId: created.id, kind: 'plan', summary: `Added task "${created.title}"` });
    emit('autonomy:task_added', { objectiveId, taskId: created.id });
    return created;
  };

  const replanObjective = (objectiveId, { reason = 'replan', newTasks = [], addTasks = [], cancelTaskIds = [] } = {}) => {
    const obj = store.getObjective(objectiveId);
    if (!obj) throw new Error(`Objective not found: ${objectiveId}`);
    for (const cid of cancelTaskIds) {
      const active = inFlight.get(cid);
      if (active) {
        try { active.abortController.abort(); } catch {}
        inFlight.delete(cid);
      }
      store.updateTask(cid, {
        status: 'cancelled',
        bumpEpoch: true,
        leaseOwner: null,
        leaseUntil: null,
        error: `Cancelled during replan: ${reason}`,
      });
    }
    const added = [];
    const specs = newTasks.length > 0 ? newTasks : addTasks;
    for (const spec of specs) {
      added.push(addTask(objectiveId, spec));
    }
    store.updateObjective(objectiveId, {
      loopPhase: 'replan',
      status: obj.status === 'blocked' || obj.status === 'waiting' ? 'active' : obj.status,
      failureStreak: 0,
      stagnationStreak: 0,
      waitingUntil: null,
      waitingReason: null,
    });
    store.recordDecision({
      objectiveId,
      kind: 'replan',
      summary: reason,
      details: { addedTaskIds: added.map((t) => t.id), cancelledTaskIds: cancelTaskIds },
    });
    emit('autonomy:replanned', { objectiveId });
    return getObjectiveDetail(objectiveId);
  };

  const attachSession = (id, sessionId) => {
    const clean = asNonEmptyString(sessionId);
    const updated = store.updateObjective(id, { sessionId: clean });
    if (updated) {
      store.recordDecision({
        objectiveId: id,
        kind: 'policy',
        summary: clean ? `Attached target chat session ${clean}` : 'Cleared target chat session (auto-create mode)',
      });
      emit('autonomy:updated', { objectiveId: id, sessionId: clean });
    }
    return updated;
  };

  const updateObjective = (id, patch = {}) => {
    const updated = store.updateObjective(id, patch);
    if (updated) {
      store.recordDecision({ objectiveId: id, kind: 'policy', summary: 'Updated objective settings' });
      emit('autonomy:updated', { objectiveId: id });
    }
    return updated;
  };

  const pauseObjective = (id, reason = 'Paused by user') => {
    const existing = store.getObjective(id);
    if (!existing) return null;
    abortObjectiveExecution(id, { reason });
    for (const task of store.listTasks(id)) {
      if (task.status === 'running') {
        store.updateTask(task.id, {
          status: 'pending',
          bumpEpoch: true,
          attempts: Math.max(0, task.attempts - 1),
          leaseOwner: null,
          leaseUntil: null,
          error: reason,
        });
      }
    }
    const updated = store.updateObjective(id, {
      status: 'paused',
      bumpEpoch: true,
      waitingUntil: null,
      waitingReason: null,
      lastError: reason,
    });
    if (updated) {
      store.recordDecision({ objectiveId: id, kind: 'policy', summary: reason });
      emit('autonomy:updated', { objectiveId: id, status: 'paused' });
    }
    return updated;
  };

  const resumeObjective = (id) => {
    const current = store.getObjective(id);
    if (!current) return null;
    const at = now();
    const tasks = store.listTasks(id);
    let requeued = 0;
    for (const task of tasks) {
      if (task.status === 'failed' || task.status === 'blocked') {
        store.updateTask(task.id, {
          status: 'pending',
          bumpEpoch: true,
          attempts: 0,
          leaseOwner: null,
          leaseUntil: null,
          nextRetryAt: at,
          error: null,
        });
        requeued += 1;
      } else if (task.status === 'pending' && task.nextRetryAt && task.nextRetryAt > at) {
        store.updateTask(task.id, { nextRetryAt: at });
      }
    }
    const hasPendingOrRunning = tasks.some((t) => t.status === 'pending' || t.status === 'running') || requeued > 0;
    if (!hasPendingOrRunning) {
      store.addTask(id, {
        title: `Continue working on: ${current.title}`,
        role: current.mode === 'ongoing' ? 'researcher' : 'supervisor',
        kind: current.mode === 'ongoing' ? 'research' : 'code',
        prompt: current.description,
        idempotencyKey: `resume_${id}_${current.turnsUsed}_${at}`,
      });
    }
    const updated = store.updateObjective(id, {
      status: 'active',
      failureStreak: 0,
      stagnationStreak: 0,
      waitingUntil: null,
      waitingReason: null,
      lastError: null,
      nextReviewAt: null,
    });
    store.recordDecision({
      objectiveId: id,
      kind: 'recovery',
      summary: requeued > 0 ? `Resumed and retried ${requeued} failed/blocked task(s)` : 'Objective resumed',
    });
    emit('autonomy:updated', { objectiveId: id, status: 'active' });
    return updated;
  };

  const continueObjective = (id, note = '') => {
    const current = store.getObjective(id);
    if (!current) return null;
    const at = now();
    const guidance = asNonEmptyString(note);
    for (const task of store.listTasks(id)) {
      if (task.status === 'failed' || task.status === 'blocked') {
        store.updateTask(task.id, { status: 'cancelled', bumpEpoch: true, leaseOwner: null, leaseUntil: null });
      }
    }
    store.addTask(id, {
      title: guidance ? `Continue: ${guidance.slice(0, 72)}` : `Continue research & execution: ${current.title}`,
      role: current.mode === 'ongoing' ? 'researcher' : 'supervisor',
      kind: current.mode === 'ongoing' ? 'research' : 'code',
      prompt: guidance ? `${current.description}\n\nUser continuation note: ${guidance}` : current.description,
      idempotencyKey: `continue_${id}_${at}`,
    });
    const updated = store.updateObjective(id, {
      status: 'active',
      failureStreak: 0,
      stagnationStreak: 0,
      waitingUntil: null,
      waitingReason: null,
      lastError: null,
      nextReviewAt: null,
      loopPhase: 'research',
    });
    store.recordDecision({
      objectiveId: id,
      kind: 'recovery',
      summary: guidance ? `Queued continuation turn: ${guidance}` : 'Queued continuation turn',
    });
    emit('autonomy:updated', { objectiveId: id, status: 'active' });
    return updated;
  };

  const cancelObjective = (id, reason = 'Cancelled by user') => {
    const existing = store.getObjective(id);
    if (!existing) return null;
    abortObjectiveExecution(id, { reason });
    for (const task of store.listTasks(id)) {
      if (task.status === 'pending' || task.status === 'running') {
        store.updateTask(task.id, { status: 'cancelled', bumpEpoch: true, leaseOwner: null, leaseUntil: null, error: reason });
      }
    }
    const updated = store.updateObjective(id, {
      status: 'cancelled',
      bumpEpoch: true,
      waitingUntil: null,
      waitingReason: null,
      lastError: reason,
    });
    if (updated) {
      store.recordDecision({ objectiveId: id, kind: 'policy', summary: reason });
      emit('autonomy:updated', { objectiveId: id, status: 'cancelled' });
    }
    return updated;
  };

  const emergencyStopAll = (reason = 'Emergency stop triggered') => {
    const candidates = [
      ...store.listObjectives({ status: 'active', limit: 500 }),
      ...store.listObjectives({ status: 'waiting', limit: 500 }),
    ];
    const stoppedIds = [];
    for (const obj of candidates) {
      pauseObjective(obj.id, reason);
      stoppedIds.push(obj.id);
    }
    emit('autonomy:emergency_stop', { stoppedIds });
    return { stoppedIds };
  };

  const recoverOnStartup = () => {
    const at = now();
    const candidates = [
      ...store.listObjectives({ status: 'active', limit: 500 }),
      ...store.listObjectives({ status: 'waiting', limit: 500 }),
    ];
    const recovered = [];
    for (const obj of candidates) {
      for (const task of store.listTasks(obj.id)) {
        if (task.status === 'running' && task.leaseOwner !== workerId) {
          store.updateTask(task.id, {
            status: 'pending',
            bumpEpoch: true,
            attempts: Math.max(0, task.attempts - 1),
            leaseOwner: null,
            leaseUntil: null,
            nextRetryAt: at,
            error: `Reclaimed after restart from ${task.leaseOwner || 'previous worker'}`,
          });
          store.recordDecision({
            objectiveId: obj.id,
            taskId: task.id,
            kind: 'recovery',
            summary: `Reclaimed interrupted task "${task.title}" after startup`,
          });
          recovered.push(task.id);
        }
      }
    }
    return { activeObjectives: candidates.length, reclaimedTasks: recovered };
  };

  const launchTaskExecution = (objective, claimedTask, parallelCount, slotIndex) => {
    const abortController = new AbortController();
    const runEpoch = claimedTask.runEpoch;
    const entry = {
      taskId: claimedTask.id,
      objectiveId: objective.id,
      runEpoch,
      sessionId: claimedTask.sessionId || objective.sessionId || null,
      abortController,
      promise: null,
    };

    const runPromise = (async () => {
      try {
        const freshObj = store.getObjective(objective.id) || objective;
        const outcome = await executeTask(freshObj, claimedTask, {
          runEpoch,
          parallelCount,
          slotIndex,
          signal: abortController.signal,
        });
        if (store.isClosed?.()) return;
        const refreshedTask = store.getTask(claimedTask.id);
        if (refreshedTask?.sessionId) entry.sessionId = refreshedTask.sessionId;
        settleTaskOutcome(objective.id, claimedTask.id, runEpoch, outcome);
      } catch (err) {
        if (!store.isClosed?.()) {
          settleTaskOutcome(objective.id, claimedTask.id, runEpoch, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        const current = inFlight.get(claimedTask.id);
        if (current && current.runEpoch === runEpoch) {
          inFlight.delete(claimedTask.id);
        }
        if (!stopped && timer && !store.isClosed?.()) {
          scheduleImmediateTick();
        }
      }
    })();

    entry.promise = runPromise;
    inFlight.set(claimedTask.id, entry);
    return runPromise;
  };

  const processObjective = async (objective, launchedPromises) => {
    const at = now();
    const budget = isRecord(objective.budget) ? objective.budget : {};
    const rawMaxTurns = budget.maxTurns;
    const maxTurns = rawMaxTurns === null || rawMaxTurns === undefined
      ? (objective.mode === 'ongoing' ? Infinity : 50)
      : (Number.isFinite(Number(rawMaxTurns)) && Number(rawMaxTurns) > 0 ? Number(rawMaxTurns) : Infinity);
    const rawMaxRuntime = budget.maxRuntimeMs;
    const maxRuntimeMs = rawMaxRuntime === null || rawMaxRuntime === undefined
      ? (objective.mode === 'ongoing' ? Infinity : 4 * 3_600_000)
      : (Number.isFinite(Number(rawMaxRuntime)) && Number(rawMaxRuntime) > 0 ? Number(rawMaxRuntime) : Infinity);
    const maxParallel = Math.max(1, Math.min(8, Number(budget.maxParallel) || 2));

    const tasksSnapshot = store.listTasks(objective.id);
    const activeRunningCount = tasksSnapshot.filter((t) => t.status === 'running').length;

    if (activeRunningCount === 0 && objective.turnsUsed >= maxTurns) {
      store.updateObjective(objective.id, { status: 'blocked', lastError: `Turn budget exhausted (${objective.turnsUsed}/${maxTurns})` });
      store.recordDecision({ objectiveId: objective.id, kind: 'budget', summary: `Turn budget exhausted (${objective.turnsUsed}/${maxTurns})` });
      return;
    }
    if (activeRunningCount === 0 && objective.mode === 'finite' && at - objective.createdAt > maxRuntimeMs) {
      store.updateObjective(objective.id, { status: 'blocked', lastError: 'Runtime budget exhausted' });
      store.recordDecision({ objectiveId: objective.id, kind: 'budget', summary: 'Runtime budget exhausted' });
      return;
    }

    for (const task of tasksSnapshot) {
      if (task.status === 'running' && !inFlight.has(task.id) && Number(task.leaseUntil) > 0 && at > Number(task.leaseUntil)) {
        const nextAttempt = task.attempts;
        if (nextAttempt < task.maxAttempts) {
          const backoff = BASE_RETRY_BACKOFF_MS * (2 ** Math.min(nextAttempt, 5));
          store.updateTask(task.id, {
            status: 'pending',
            bumpEpoch: true,
            leaseOwner: null,
            leaseUntil: null,
            nextRetryAt: at + backoff,
            error: 'Worker lease expired; retrying from checkpoint',
          });
          store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'recovery', summary: `Lease expired; retry #${nextAttempt}` });
        } else {
          store.updateTask(task.id, {
            status: 'failed',
            bumpEpoch: true,
            leaseOwner: null,
            leaseUntil: null,
            error: 'Lease expired after max retries',
          });
          store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'blocker', summary: `Task "${task.title}" failed after max lease retries` });
        }
      }
    }

    const currentTasks = store.listTasks(objective.id);
    const byId = new Map(currentTasks.map((t) => [t.id, t]));
    for (const pending of currentTasks.filter((t) => t.status === 'pending')) {
      const blockedBy = pending.dependsOn.find((depId) => {
        const st = byId.get(depId)?.status;
        return st === 'failed' || st === 'blocked' || st === 'cancelled';
      });
      if (blockedBy) {
        store.updateTask(pending.id, { status: 'blocked', bumpEpoch: true, error: `Blocked by failed dependency ${blockedBy}` });
      }
    }

    const refreshed = store.listTasks(objective.id);
    const refreshedById = new Map(refreshed.map((t) => [t.id, t]));
    const runningTasks = refreshed.filter((t) => t.status === 'running');
    const slots = Math.max(0, maxParallel - runningTasks.length);

    const ready = refreshed.filter((task) => {
      if (task.status !== 'pending') return false;
      if (task.nextRetryAt && at < task.nextRetryAt) return false;
      return task.dependsOn.every((depId) => refreshedById.get(depId)?.status === 'completed');
    }).slice(0, slots);

    if (ready.length > 0 && executeTask) {
      let turnsUsed = objective.turnsUsed;
      const actualParallel = ready.length + runningTasks.length;
      let slotIdx = runningTasks.length;
      for (const candidate of ready) {
        if (turnsUsed >= maxTurns) break;
        const claimed = store.claimTaskForExecution(candidate.id, { workerId, leaseMs, at });
        if (!claimed) continue;
        turnsUsed += 1;
        const phaseByKind = { research: 'research', verify: 'validate', curate: 'remember', code: 'experiment', test: 'observe' };
        store.updateObjective(objective.id, {
          loopPhase: phaseByKind[claimed.kind] || 'experiment',
          turnsUsed,
          waitingUntil: null,
          waitingReason: null,
        });
        launchedPromises.push(launchTaskExecution(objective, claimed, actualParallel, slotIdx));
        slotIdx += 1;
      }
      return;
    }

    await evaluateSettledObjective(store.getObjective(objective.id) || objective);
  };

  const tick = async ({ awaitTasks = true } = {}) => {
    if (stopped || store.isClosed?.()) return;
    if (ticking) {
      pendingImmediateTick = true;
      if (awaitTasks && inFlight.size > 0) {
        await Promise.allSettled([...inFlight.values()].map((item) => item.promise));
      }
      return;
    }
    ticking = true;
    const launchedPromises = [];
    try {
      const at = now();
      for (const obj of store.listObjectives({ status: 'waiting', limit: 200 })) {
        if (obj.mode === 'ongoing' && obj.nextReviewAt && at >= obj.nextReviewAt) {
          store.updateObjective(obj.id, { status: 'active', loopPhase: 'research', waitingUntil: null, waitingReason: null });
          store.addTask(obj.id, {
            title: `Ongoing review cycle #${obj.turnsUsed + 1}: ${obj.title}`,
            role: 'researcher',
            kind: 'research',
            prompt: obj.description,
            idempotencyKey: `ongoing_${obj.id}_${obj.turnsUsed + 1}`,
          });
        }
      }
      for (const obj of store.listObjectives({ status: 'active', limit: 200 })) {
        if (stopped) break;
        await processObjective(obj, launchedPromises);
      }
    } finally {
      ticking = false;
      armWakeTimer();
      if (pendingImmediateTick && !stopped) {
        pendingImmediateTick = false;
        scheduleImmediateTick();
      }
    }

    if (awaitTasks && launchedPromises.length > 0) {
      await Promise.allSettled(launchedPromises);
    }
  };

  const start = () => {
    stopped = false;
    const recovered = recoverOnStartup();
    if (!timer) {
      timer = setInterval(() => { void tick({ awaitTasks: false }); }, tickIntervalMs);
      timer.unref?.();
    }
    if (executionCoordinator?.subscribeWake) {
      unsubscribers.push(executionCoordinator.subscribeWake((evt) => {
        if (evt?.reason === 'limit_resumed' || evt?.reason === 'turn_released' || evt?.reason === 'controller_released') {
          if (evt.reason === 'limit_resumed' && asNonEmptyString(evt.sessionId) && !store.isClosed?.()) {
            const at = now();
            for (const task of store.listTasksBySession(evt.sessionId)) {
              if (task.status === 'pending' && task.nextRetryAt && task.nextRetryAt > at) {
                store.updateTask(task.id, { nextRetryAt: at });
              }
            }
          }
          scheduleImmediateTick();
        }
      }));
    }
    if (globalEventHub?.subscribeStatus) {
      unsubscribers.push(globalEventHub.subscribeStatus((st) => {
        if (st?.type === 'connect') scheduleImmediateTick();
      }));
    }
    armWakeTimer();
    return recovered;
  };

  const stop = () => {
    stopped = true;
    clearWakeTimer();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    for (const unsub of unsubscribers.splice(0)) {
      try { unsub(); } catch {}
    }
    for (const active of inFlight.values()) {
      try { active.abortController.abort(); } catch {}
    }
    inFlight.clear();
  };

  const waitForIdle = async () => {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight.values()].map((item) => item.promise));
    }
  };

  const getStatus = () => {
    const all = store.listObjectives({ limit: 500 });
    const counts = { active: 0, paused: 0, waiting: 0, blocked: 0, completed: 0, failed: 0, cancelled: 0 };
    let waitingProviderCount = 0;
    for (const o of all) {
      if (Object.hasOwn(counts, o.status)) counts[o.status] += 1;
      if (o.waitingReason === 'waiting_provider') waitingProviderCount += 1;
    }
    return {
      running: !stopped && Boolean(timer),
      workerId,
      inFlightTasks: inFlight.size,
      waitingProviderObjectives: waitingProviderCount,
      totalObjectives: all.length,
      counts,
      coordinator: executionCoordinator ? executionCoordinator.getStatus() : null,
    };
  };

  return {
    createObjective,
    getObjective: getObjectiveDetail,
    listObjectives: (filters) => store.listObjectives(filters),
    addTask,
    attachSession,
    updateObjective,
    replanObjective,
    pauseObjective,
    resumeObjective,
    continueObjective,
    cancelObjective,
    emergencyStopAll,
    verifyObjective: verifyObjectiveNow,
    recoverOnStartup,
    tick,
    waitForIdle,
    start,
    stop,
    getStatus,
  };
};
