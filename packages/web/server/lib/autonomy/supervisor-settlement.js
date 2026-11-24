import crypto from 'node:crypto';
import { asNonEmptyString, isRecord } from '../shared/guards.js';

export const BASE_RETRY_BACKOFF_MS = 5_000;
export const MAX_FAILURE_STREAK = 3;
export const MAX_STAGNATION_STREAK = 4;

export const validateTaskDag = (tasks) => {
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

export const computeProgressHash = (text) => {
  const normalized = String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}[^\s]*/g, '')
    .trim();
  if (!normalized) return 'empty';
  return crypto.createHash('sha1').update(normalized.slice(0, 1200)).digest('hex').slice(0, 16);
};

export const createSupervisorSettlement = ({
  store,
  verifyObjectiveNow,
  onObjectiveCompleted,
  getObjectiveDetail,
  emit,
  armWakeTimer,
  scheduleImmediateTick,
  now,
}) => {
  const settleTaskOutcome = (objectiveId, taskId, runEpoch, outcome) => {
    const currentObj = store.getObjective(objectiveId);
    const currentTask = store.getTask(taskId);
    if (!currentObj || !currentTask || currentTask.runEpoch !== runEpoch) return;
    if (currentObj.status === 'paused' || currentObj.status === 'cancelled') return;

    const at = now();
    if (outcome?.aborted === true) return;

    if (outcome?.deferred === true) {
      const wakeAt = Number(outcome.resetAt) || Number(outcome.nextWakeAt) || (at + 10_000);
      const isLimit = outcome.kind === 'usage_limit' || outcome.kind === 'waiting_provider';
      const revertedAttempts = Math.max(0, currentTask.attempts - 1);
      const nextWaits = isLimit ? (currentTask.providerWaits || 0) + 1 : (currentTask.providerWaits || 0);
      const reason = isLimit
        ? `Waiting for provider quota reset (resumes at ${new Date(wakeAt).toISOString()})`
        : (asNonEmptyString(outcome.error) || 'Deferred until session/backend is ready');

      const updated = store.updateTaskIfEpoch(taskId, runEpoch, {
        status: 'pending',
        attempts: revertedAttempts,
        providerWaits: nextWaits,
        leaseOwner: null,
        leaseUntil: null,
        checkpoint: outcome.checkpoint ?? currentTask.checkpoint ?? null,
        nextRetryAt: wakeAt,
        error: null,
      });
      if (!updated) return;

      store.updateObjective(objectiveId, {
        turnsUsed: Math.max(0, currentObj.turnsUsed - 1),
        waitingUntil: wakeAt,
        waitingReason: isLimit ? 'waiting_provider' : (outcome.kind || 'deferred'),
        lastError: null,
      });
      store.recordDecision({
        objectiveId,
        taskId,
        kind: 'recovery',
        summary: reason,
        details: { kind: outcome.kind, wakeAt, providerWaits: nextWaits },
      });
      emit('autonomy:waiting_provider', { objectiveId, taskId, wakeAt, kind: outcome.kind });
      armWakeTimer();
      return;
    }

    if (outcome?.ok === false) {
      const errMsg = asNonEmptyString(outcome.error) || 'Task execution failed';
      const canRetry = currentTask.attempts < currentTask.maxAttempts;
      const retryDelay = BASE_RETRY_BACKOFF_MS * (2 ** Math.min(currentTask.attempts, 5));
      const updated = store.updateTaskIfEpoch(taskId, runEpoch, {
        status: canRetry ? 'pending' : 'failed',
        leaseOwner: null,
        leaseUntil: null,
        error: errMsg,
        checkpoint: outcome.checkpoint ?? currentTask.checkpoint ?? null,
        nextRetryAt: canRetry ? at + retryDelay : null,
      });
      if (!updated) return;

      const latestObj = store.getObjective(objectiveId);
      const nextStreak = (latestObj?.failureStreak ?? 0) + 1;
      store.updateObjective(objectiveId, {
        failureStreak: nextStreak,
        waitingUntil: canRetry ? at + retryDelay : null,
        waitingReason: canRetry ? 'retry_backoff' : null,
        lastError: errMsg,
        status: !canRetry && nextStreak >= MAX_FAILURE_STREAK ? 'blocked' : latestObj?.status,
      });
      store.recordDecision({ objectiveId, taskId, kind: 'blocker', summary: errMsg });
      emit('autonomy:task_failed', { objectiveId, taskId, retrying: canRetry, error: errMsg });
      armWakeTimer();
      return;
    }

    const resultText = asNonEmptyString(outcome?.result) || 'Completed';
    const updated = store.updateTaskIfEpoch(taskId, runEpoch, {
      status: 'completed',
      leaseOwner: null,
      leaseUntil: null,
      result: resultText,
      artifacts: Array.isArray(outcome?.artifacts) ? outcome.artifacts : [],
      checkpoint: outcome?.checkpoint ?? currentTask.checkpoint ?? null,
      error: null,
    });
    if (!updated) return;

    const latestObj = store.getObjective(objectiveId);
    const hash = computeProgressHash(resultText);
    const sameAsPrevious = Boolean(latestObj?.lastProgressHash && latestObj.lastProgressHash === hash);
    const nextStagnation = sameAsPrevious ? (latestObj.stagnationStreak || 0) + 1 : 0;

    store.updateObjective(objectiveId, {
      failureStreak: 0,
      stagnationStreak: nextStagnation,
      lastProgressHash: hash,
      waitingUntil: null,
      waitingReason: null,
      lastError: null,
      loopPhase: nextStagnation >= 2 ? 'replan' : 'observe',
    });
    store.recordDecision({
      objectiveId,
      taskId,
      kind: 'dispatch',
      summary: `Completed task "${currentTask.title}"`,
    });
    emit('autonomy:task_completed', { objectiveId, taskId });
  };

  const evaluateSettledObjective = async (objective) => {
    const budget = isRecord(objective.budget) ? objective.budget : {};
    const postTasks = store.listTasks(objective.id);
    if (postTasks.length === 0) return;
    if (postTasks.some((t) => t.status === 'pending' || t.status === 'running')) return;

    const anyFailed = postTasks.some((t) => t.status === 'failed' || t.status === 'blocked');
    if (anyFailed) {
      store.updateObjective(objective.id, {
        status: 'blocked',
        waitingUntil: null,
        waitingReason: null,
        lastError: 'One or more tasks failed or are blocked',
      });
      emit('autonomy:updated', { objectiveId: objective.id, status: 'blocked' });
      return;
    }

    if (objective.mode === 'ongoing' && objective.stagnationStreak >= MAX_STAGNATION_STREAK) {
      const slowInterval = Math.max(60_000, (Number(budget.reviewIntervalMs) || 30_000) * 4);
      const nextReview = now() + slowInterval;
      store.updateObjective(objective.id, {
        status: 'waiting',
        loopPhase: 'replan',
        nextReviewAt: nextReview,
        waitingUntil: nextReview,
        waitingReason: 'stagnation_sleep',
        lastError: null,
      });
      store.recordDecision({
        objectiveId: objective.id,
        kind: 'replan',
        summary: `Paused repetitive output cycle into extended sleep (${Math.round(slowInterval / 1000)}s) until new work or review interval`,
      });
      emit('autonomy:updated', { objectiveId: objective.id, status: 'waiting' });
      return;
    }

    const verifyRes = await verifyObjectiveNow(objective.id);
    if (verifyRes.status === 'passed' || (objective.mode === 'ongoing' && verifyRes.status === 'unverified')) {
      if (objective.mode === 'ongoing') {
        const intervalMs = Math.max(5_000, Number(budget.reviewIntervalMs) || 30_000);
        const nextReview = now() + intervalMs;
        store.updateObjective(objective.id, {
          status: 'waiting',
          loopPhase: 'remember',
          nextReviewAt: nextReview,
          waitingUntil: nextReview,
          waitingReason: 'scheduled_review',
          lastError: null,
        });
        store.recordDecision({
          objectiveId: objective.id,
          kind: 'verify',
          summary: `Ongoing cycle finished (${verifyRes.status}); sleeping ${Math.round(intervalMs / 1000)}s until next review`,
        });
      } else {
        store.updateObjective(objective.id, {
          status: 'completed',
          loopPhase: 'remember',
          waitingUntil: null,
          waitingReason: null,
          completedAt: now(),
          lastError: null,
        });
      }
      emit('autonomy:updated', { objectiveId: objective.id, status: store.getObjective(objective.id)?.status });
      if (onObjectiveCompleted) {
        await Promise.resolve(onObjectiveCompleted(getObjectiveDetail(objective.id), verifyRes)).catch(() => {});
      }
    } else if (verifyRes.status === 'failed') {
      if (objective.mode === 'ongoing') {
        const intervalMs = Math.max(5_000, Number(budget.reviewIntervalMs) || 30_000);
        const nextReview = now() + intervalMs;
        store.updateObjective(objective.id, {
          status: 'waiting',
          loopPhase: 'remember',
          nextReviewAt: nextReview,
          waitingUntil: nextReview,
          waitingReason: 'scheduled_review',
          lastError: null,
        });
        store.recordDecision({
          objectiveId: objective.id,
          kind: 'verify',
          summary: `Verification check exited non-zero (${verifyRes.summary}); continuing ongoing cycle in ${Math.round(intervalMs / 1000)}s`,
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
          scheduleImmediateTick();
        }
      }
    } else {
      store.updateObjective(objective.id, {
        status: 'blocked',
        waitingUntil: null,
        waitingReason: null,
        lastError: verifyRes.summary,
      });
      emit('autonomy:updated', { objectiveId: objective.id, status: 'blocked' });
    }
  };

  return { settleTaskOutcome, evaluateSettledObjective };
};
