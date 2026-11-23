import { asNonEmptyString, isRecord } from '../shared/guards.js';

const DEFAULT_LEASE_MS = 10 * 60_000;
const BASE_RETRY_BACKOFF_MS = 5_000;
const MAX_FAILURE_STREAK = 3;

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

const validateTaskDag = (tasks) => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map();
  const visit = (id) => {
    const s = state.get(id) ?? 0;
    if (s === 1) return false;
    if (s === 2) return true;
    state.set(id, 1);
    const task = byId.get(id);
    for (const dep of task?.dependsOn ?? []) {
      if (dep === id) return false;
      if (byId.has(dep) && !visit(dep)) return false;
    }
    state.set(id, 2);
    return true;
  };
  for (const t of tasks) {
    if (!visit(t.id)) return { valid: false, error: `Cycle detected involving task ${t.id}` };
  }
  return { valid: true };
};

export const createAutonomySupervisor = ({
  store,
  verifier,
  executeTask = null,
  onObjectiveCompleted = null,
  broadcastEvent = null,
  workerId = `supervisor-${process.pid}`,
  tickIntervalMs = 5_000,
  leaseMs = DEFAULT_LEASE_MS,
  now = () => Date.now(),
} = {}) => {
  let timer = null;
  let ticking = false;
  let stopped = false;

  const emit = (type, payload) => {
    if (broadcastEvent) {
      try { broadcastEvent({ type, ...payload, timestamp: now() }); } catch {}
    }
  };

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
    store.recordDecision({
      objectiveId: objective.id,
      kind: 'plan',
      summary: `Created ${objective.mode} objective with ${createdTasks.length} initial task(s)`,
      details: { taskIds: createdTasks.map((t) => t.id) },
    });
    emit('autonomy:objective_created', { objectiveId: objective.id });
    return getObjectiveDetail(objective.id);
  };

  const getObjectiveDetail = (id) => {
    const objective = store.getObjective(id);
    if (!objective) return null;
    return {
      ...objective,
      tasks: store.listTasks(id),
      decisions: store.listDecisions(id, 50),
      verifications: store.listVerifications(id, 20),
    };
  };

  const addTask = (objectiveId, taskInput = {}) => {
    const obj = store.getObjective(objectiveId);
    if (!obj) throw new Error(`Objective not found: ${objectiveId}`);
    const existing = store.listTasks(objectiveId);
    const created = store.addTask(objectiveId, taskInput);
    const check = validateTaskDag([...existing.filter((t) => t.id !== created.id), created]);
    if (!check.valid) {
      store.updateTask(created.id, { status: 'cancelled', error: check.error });
      throw new Error(check.error);
    }
    store.recordDecision({ objectiveId, taskId: created.id, kind: 'plan', summary: `Added task "${created.title}"` });
    emit('autonomy:task_added', { objectiveId, taskId: created.id });
    return created;
  };

  const replanObjective = (objectiveId, { reason = 'replan', newTasks = [], addTasks = [], cancelTaskIds = [] } = {}) => {
    const obj = store.getObjective(objectiveId);
    if (!obj) throw new Error(`Objective not found: ${objectiveId}`);
    for (const cid of cancelTaskIds) {
      store.updateTask(cid, { status: 'cancelled', error: `Cancelled during replan: ${reason}` });
    }
    const added = [];
    const specs = newTasks.length > 0 ? newTasks : addTasks;
    for (const spec of specs) {
      added.push(addTask(objectiveId, spec));
    }
    store.updateObjective(objectiveId, { loopPhase: 'replan', status: obj.status === 'blocked' ? 'active' : obj.status, failureStreak: 0 });
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
    const updated = store.updateObjective(id, { status: 'paused', lastError: reason });
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
          attempts: 0,
          leaseOwner: null,
          leaseUntil: null,
          nextRetryAt: at,
          error: null,
        });
        requeued += 1;
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
    const updated = store.updateObjective(id, { status: 'active', failureStreak: 0, lastError: null, nextReviewAt: null });
    store.recordDecision({ objectiveId: id, kind: 'recovery', summary: requeued > 0 ? `Resumed and retried ${requeued} failed/blocked task(s)` : 'Objective resumed with next continuation turn' });
    emit('autonomy:updated', { objectiveId: id, status: 'active' });
    return updated;
  };

  const continueObjective = (id, note = '') => {
    const current = store.getObjective(id);
    if (!current) return null;
    const at = now();
    const guidance = asNonEmptyString(note);
    const tasks = store.listTasks(id);
    for (const task of tasks) {
      if (task.status === 'failed' || task.status === 'blocked') {
        store.updateTask(task.id, {
          status: 'cancelled',
          leaseOwner: null,
          leaseUntil: null,
        });
      }
    }
    store.addTask(id, {
      title: guidance ? `Continue: ${guidance.slice(0, 72)}` : `Continue research & execution: ${current.title}`,
      role: current.mode === 'ongoing' ? 'researcher' : 'supervisor',
      kind: current.mode === 'ongoing' ? 'research' : 'code',
      prompt: guidance ? `${current.description}\n\nUser continuation note: ${guidance}` : current.description,
      idempotencyKey: `continue_${id}_${at}`,
    });
    const updated = store.updateObjective(id, { status: 'active', failureStreak: 0, lastError: null, nextReviewAt: null, loopPhase: 'research' });
    store.recordDecision({ objectiveId: id, kind: 'recovery', summary: guidance ? `Queued continuation turn: ${guidance}` : 'Queued continuation turn' });
    emit('autonomy:updated', { objectiveId: id, status: 'active' });
    return updated;
  };

  const cancelObjective = (id, reason = 'Cancelled by user') => {
    const tasks = store.listTasks(id);
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'running') {
        store.updateTask(task.id, { status: 'cancelled', leaseOwner: null, leaseUntil: null, error: reason });
      }
    }
    const updated = store.updateObjective(id, { status: 'cancelled', lastError: reason });
    if (updated) {
      store.recordDecision({ objectiveId: id, kind: 'policy', summary: reason });
      emit('autonomy:updated', { objectiveId: id, status: 'cancelled' });
    }
    return updated;
  };

  const emergencyStopAll = (reason = 'Emergency stop triggered') => {
    const active = store.listObjectives({ status: 'active' });
    const stoppedIds = [];
    for (const obj of active) {
      pauseObjective(obj.id, reason);
      for (const task of store.listTasks(obj.id)) {
        if (task.status === 'running') {
          store.updateTask(task.id, { status: 'pending', leaseOwner: null, leaseUntil: null, error: reason });
        }
      }
      stoppedIds.push(obj.id);
    }
    emit('autonomy:emergency_stop', { stoppedIds });
    return { stoppedIds };
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

  const recoverOnStartup = () => {
    const at = now();
    const active = store.listObjectives({ status: 'active' });
    const recovered = [];
    for (const obj of active) {
      const tasks = store.listTasks(obj.id);
      for (const task of tasks) {
        if (task.status === 'running' && task.leaseOwner !== workerId) {
          store.updateTask(task.id, {
            status: 'pending',
            leaseOwner: null,
            leaseUntil: null,
            nextRetryAt: at,
            error: `Reclaimed after restart from ${task.leaseOwner || 'previous worker'}`,
          });
          store.recordDecision({
            objectiveId: obj.id,
            taskId: task.id,
            kind: 'recovery',
            summary: `Reclaimed orphaned running task "${task.title}" after restart`,
          });
          recovered.push(task.id);
        }
      }
    }
    return { activeObjectives: active.length, reclaimedTasks: recovered };
  };

  const processObjective = async (objective) => {
    const at = now();
    const budget = isRecord(objective.budget) ? objective.budget : {};
    const maxTurns = Number(budget.maxTurns) || 25;
    const maxRuntimeMs = Number(budget.maxRuntimeMs) || 3_600_000;
    const maxParallel = Number(budget.maxParallel) || 2;

    if (objective.turnsUsed >= maxTurns) {
      store.updateObjective(objective.id, { status: 'blocked', lastError: `Turn budget exhausted (${objective.turnsUsed}/${maxTurns})` });
      store.recordDecision({ objectiveId: objective.id, kind: 'budget', summary: `Turn budget exhausted (${objective.turnsUsed}/${maxTurns})` });
      return;
    }
    if (objective.mode === 'finite' && at - objective.createdAt > maxRuntimeMs) {
      store.updateObjective(objective.id, { status: 'blocked', lastError: 'Runtime budget exhausted' });
      store.recordDecision({ objectiveId: objective.id, kind: 'budget', summary: 'Runtime budget exhausted' });
      return;
    }

    const tasks = store.listTasks(objective.id);
    for (const task of tasks) {
      if (task.status === 'running' && Number(task.leaseUntil) > 0 && at > Number(task.leaseUntil)) {
        const nextAttempt = task.attempts + 1;
        if (nextAttempt < task.maxAttempts) {
          const backoff = BASE_RETRY_BACKOFF_MS * (2 ** Math.min(nextAttempt, 5));
          store.updateTask(task.id, {
            status: 'pending',
            attempts: nextAttempt,
            leaseOwner: null,
            leaseUntil: null,
            nextRetryAt: at + backoff,
            error: 'Worker lease expired; retrying with backoff',
          });
          store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'recovery', summary: `Lease expired; retry #${nextAttempt}` });
        } else {
          store.updateTask(task.id, { status: 'failed', attempts: nextAttempt, leaseOwner: null, leaseUntil: null, error: 'Lease expired after max retries' });
          store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'blocker', summary: `Task "${task.title}" failed after max lease retries` });
        }
      }
    }

    const currentTasks = store.listTasks(objective.id);
    const byId = new Map(currentTasks.map((t) => [t.id, t]));
    const runningCount = currentTasks.filter((t) => t.status === 'running').length;

    const failedTasks = currentTasks.filter((t) => t.status === 'failed');
    if (failedTasks.length > 0 && runningCount === 0) {
      for (const pending of currentTasks.filter((t) => t.status === 'pending')) {
        const blockedBy = pending.dependsOn.find((depId) => byId.get(depId)?.status === 'failed' || byId.get(depId)?.status === 'blocked');
        if (blockedBy) {
          store.updateTask(pending.id, { status: 'blocked', error: `Blocked by failed dependency ${blockedBy}` });
        }
      }
    }

    const refreshed = store.listTasks(objective.id);
    const slots = Math.max(0, maxParallel - refreshed.filter((t) => t.status === 'running').length);
    const ready = refreshed.filter((task) => {
      if (task.status !== 'pending') return false;
      if (task.nextRetryAt && at < task.nextRetryAt) return false;
      return task.dependsOn.every((depId) => byId.get(depId)?.status === 'completed');
    }).slice(0, slots);

    if (ready.length > 0 && executeTask) {
      let turnsUsed = objective.turnsUsed;
      for (const task of ready) {
        if (turnsUsed >= maxTurns) break;
        turnsUsed += 1;
        const phaseByKind = { research: 'research', verify: 'validate', curate: 'remember', code: 'experiment', test: 'observe' };
        store.updateObjective(objective.id, { loopPhase: phaseByKind[task.kind] || 'experiment', turnsUsed });
        store.updateTask(task.id, {
          status: 'running',
          leaseOwner: workerId,
          leaseUntil: at + leaseMs,
          heartbeatAt: at,
          attempts: task.attempts + 1,
        });
        try {
          const outcome = await executeTask(objective, store.getTask(task.id));
          if (outcome?.ok === false) {
            const errMsg = asNonEmptyString(outcome.error) || 'Task execution failed';
            const latestTask = store.getTask(task.id);
            const canRetry = latestTask && latestTask.attempts < latestTask.maxAttempts;
            const retryDelay = BASE_RETRY_BACKOFF_MS * (2 ** Math.min(latestTask?.attempts ?? 1, 5));
            store.updateTask(task.id, {
              status: canRetry ? 'pending' : 'failed',
              leaseOwner: null,
              leaseUntil: null,
              error: errMsg,
              checkpoint: outcome.checkpoint ?? latestTask?.checkpoint ?? null,
              nextRetryAt: canRetry ? now() + retryDelay : null,
            });
            const nextStreak = objective.failureStreak + 1;
            store.updateObjective(objective.id, {
              failureStreak: nextStreak,
              lastError: errMsg,
              status: nextStreak >= MAX_FAILURE_STREAK ? 'blocked' : 'active',
            });
            store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'blocker', summary: errMsg });
          } else {
            store.updateTask(task.id, {
              status: 'completed',
              leaseOwner: null,
              leaseUntil: null,
              result: asNonEmptyString(outcome?.result) || 'Completed',
              artifacts: Array.isArray(outcome?.artifacts) ? outcome.artifacts : [],
              checkpoint: outcome?.checkpoint ?? null,
              error: null,
            });
            store.updateObjective(objective.id, { failureStreak: 0, lastError: null, loopPhase: 'observe' });
            store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'dispatch', summary: `Completed task "${task.title}"` });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const latestTask = store.getTask(task.id);
          const canRetry = latestTask && latestTask.attempts < latestTask.maxAttempts;
          store.updateTask(task.id, {
            status: canRetry ? 'pending' : 'failed',
            leaseOwner: null,
            leaseUntil: null,
            error: errMsg,
            nextRetryAt: canRetry ? now() + BASE_RETRY_BACKOFF_MS : null,
          });
          store.recordDecision({ objectiveId: objective.id, taskId: task.id, kind: 'blocker', summary: errMsg });
        }
      }
      return;
    }

    const postTasks = store.listTasks(objective.id);
    const anyPendingOrRunning = postTasks.some((t) => t.status === 'pending' || t.status === 'running');
    if (postTasks.length > 0 && !anyPendingOrRunning) {
      const anyFailed = postTasks.some((t) => t.status === 'failed' || t.status === 'blocked');
      if (anyFailed) {
        store.updateObjective(objective.id, { status: 'blocked', lastError: 'One or more tasks failed or are blocked' });
        return;
      }

      const verifyRes = await verifyObjectiveNow(objective.id);
      if (verifyRes.status === 'passed' || (objective.mode === 'ongoing' && verifyRes.status === 'unverified')) {
        if (objective.mode === 'ongoing') {
          const intervalMs = Math.max(10_000, Number(budget.reviewIntervalMs) || 30_000);
          const nextReview = now() + intervalMs;
          store.updateObjective(objective.id, { status: 'waiting', loopPhase: 'remember', nextReviewAt: nextReview, lastError: null });
          store.recordDecision({
            objectiveId: objective.id,
            kind: 'verify',
            summary: `Ongoing cycle finished (${verifyRes.status}); next continuation scheduled in ${Math.round(intervalMs / 1000)}s`,
          });
        } else {
          store.updateObjective(objective.id, { status: 'completed', loopPhase: 'remember', completedAt: now(), lastError: null });
        }
        if (onObjectiveCompleted) {
          await Promise.resolve(onObjectiveCompleted(getObjectiveDetail(objective.id), verifyRes)).catch(() => {});
        }
      } else if (verifyRes.status === 'failed') {
        if (objective.mode === 'ongoing') {
          const intervalMs = Math.max(10_000, Number(budget.reviewIntervalMs) || 30_000);
          const nextReview = now() + intervalMs;
          store.updateObjective(objective.id, { status: 'waiting', loopPhase: 'remember', nextReviewAt: nextReview, lastError: null });
          store.recordDecision({
            objectiveId: objective.id,
            kind: 'verify',
            summary: `Verification check exited non-zero (${verifyRes.summary}); continuing ongoing research in ${Math.round(intervalMs / 1000)}s without forcing code edits`,
          });
          if (onObjectiveCompleted) {
            await Promise.resolve(onObjectiveCompleted(getObjectiveDetail(objective.id), verifyRes)).catch(() => {});
          }
        } else {
          const nextStreak = objective.failureStreak + 1;
          if (nextStreak >= MAX_FAILURE_STREAK) {
            store.updateObjective(objective.id, { status: 'blocked', failureStreak: nextStreak, lastError: verifyRes.summary });
            store.recordDecision({ objectiveId: objective.id, kind: 'blocker', summary: `Stopped after ${nextStreak} consecutive verification failures` });
          } else {
            store.updateObjective(objective.id, { failureStreak: nextStreak, loopPhase: 'replan', lastError: verifyRes.summary });
            for (const followUp of verifyRes.followUpTasks) {
              store.addTask(objective.id, { ...followUp, idempotencyKey: `fix_${verifyRes.verification.id}_${followUp.title}` });
            }
          }
        }
      } else {
        store.updateObjective(objective.id, {
          status: 'blocked',
          lastError: verifyRes.summary,
        });
      }
    }
  };

  const tick = async () => {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const at = now();
      const waitingOngoing = store.listObjectives({ status: 'waiting' });
      for (const obj of waitingOngoing) {
        if (obj.mode === 'ongoing' && obj.nextReviewAt && at >= obj.nextReviewAt) {
          store.updateObjective(obj.id, { status: 'active', loopPhase: 'research' });
          store.addTask(obj.id, {
            title: `Ongoing review cycle #${obj.turnsUsed + 1}: ${obj.title}`,
            role: 'researcher',
            kind: 'research',
            prompt: obj.description,
            idempotencyKey: `ongoing_${obj.id}_${obj.turnsUsed + 1}`,
          });
        }
      }
      const active = store.listObjectives({ status: 'active' });
      for (const obj of active) {
        if (stopped) break;
        await processObjective(obj);
      }
    } finally {
      ticking = false;
    }
  };

  const start = () => {
    stopped = false;
    const recovered = recoverOnStartup();
    if (!timer) {
      timer = setInterval(() => { void tick(); }, tickIntervalMs);
      timer.unref?.();
    }
    return recovered;
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const getStatus = () => {
    const all = store.listObjectives({ limit: 500 });
    const counts = { active: 0, paused: 0, waiting: 0, blocked: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const o of all) {
      if (Object.hasOwn(counts, o.status)) counts[o.status] += 1;
    }
    return { running: !stopped && Boolean(timer), workerId, totalObjectives: all.length, counts };
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
    start,
    stop,
    getStatus,
  };
};
