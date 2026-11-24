import crypto from 'node:crypto';
import { asNonEmptyString, isRecord, isString } from '../shared/guards.js';
import { isLimitError } from '../limit-failover/policy.js';
import { providerLimitResetAt } from '../session-recovery/reconciler.js';
import { stripRecalledContextBlocks } from './compaction-bridge.js';
import { buildAutonomyTaskPrompt, createOpenCodeSessionAdapter } from './prompt-builder.js';

export { buildAutonomyTaskPrompt, createOpenCodeSessionAdapter };

const DEFAULT_POLL_MS = 1_500;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 900_000;
const DEFAULT_UNAVAILABLE_GRACE_MS = 60_000;
const DEFAULT_LEASE_MS = 10 * 60_000;
const TRANSIENT_BACKEND_RE = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|not ready|502|503|504/i;

const sleep = (ms, signal = null) => new Promise((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
  let onAbort = null;
  const timer = setTimeout(() => {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  timer.unref?.();
  if (signal) {
    onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }
});

export const createAutonomySessionExecutor = ({
  store,
  sessionService = null,
  executionCoordinator = null,
  memfsStore = null,
  readSessionStatus = null,
  readLastAssistantMessage = null,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxTurnWaitMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
  unavailableGraceMs = DEFAULT_UNAVAILABLE_GRACE_MS,
  leaseMs = DEFAULT_LEASE_MS,
  workerId = `executor-${process.pid}`,
  now = () => Date.now(),
  wait = sleep,
} = {}) => {
  const resolveSessionAndDirectory = async (objective, task, { parallelCount = 1, slotIndex = 0 } = {}) => {
    const taskSession = asNonEmptyString(task?.sessionId);
    const taskDir = asNonEmptyString(task?.worktreePath) || objective.directory;
    if (taskSession) return { sessionId: taskSession, directory: taskDir };

    const existingObjSession = asNonEmptyString(objective?.sessionId);
    const needsDedicatedSession = (
      objective.useWorktrees === true
      || (parallelCount > 1 && slotIndex > 0)
    ) && Boolean(sessionService?.create);

    if (!needsDedicatedSession && existingObjSession) {
      return { sessionId: existingObjSession, directory: objective.directory };
    }
    if (!sessionService?.create) {
      return { sessionId: existingObjSession || null, directory: objective.directory };
    }

    const titleSuffix = needsDedicatedSession
      ? `${String(objective.title || 'Objective').slice(0, 32)} · ${String(task.title || 'Task').slice(0, 28)}`
      : String(objective.title || 'Objective').slice(0, 60);
    const created = await sessionService.create({
      directory: objective.directory,
      title: `Autonomy · ${titleSuffix}`,
    });
    const sessionId = asNonEmptyString(created?.sessionId) || asNonEmptyString(created?.id);
    if (!sessionId) return { sessionId: null, directory: objective.directory };

    let effectiveDir = asNonEmptyString(created?.directory) || objective.directory;
    if (objective.useWorktrees === true && sessionService.moveToWorktree) {
      try {
        const slug = String(task.title || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'task';
        const moved = await sessionService.moveToWorktree(sessionId, {
          directory: objective.directory,
          worktree: { name: `autonomy-${slug}-${crypto.randomBytes(2).toString('hex')}` },
        });
        const wtPath = asNonEmptyString(moved?.worktree?.path);
        if (wtPath) effectiveDir = wtPath;
      } catch {}
    }

    if (!needsDedicatedSession && !existingObjSession) {
      store.updateObjective(objective.id, { sessionId });
    }
    return { sessionId, directory: effectiveDir };
  };

  const isObjectiveStopped = (objectiveId) => {
    const current = store.getObjective(objectiveId);
    return !current || current.status === 'paused' || current.status === 'cancelled';
  };

  const recallRelevantMemories = (objective, task) => {
    if (!memfsStore?.searchMemories) return [];
    try {
      return memfsStore.searchMemories({
        query: `${objective.title} ${task.title}`,
        scope: 'project',
        scopeId: objective.directory || '',
        minConfidence: 0.55,
        limit: 5,
      });
    } catch {
      return [];
    }
  };

  const runTurnOnSession = async ({
    objective,
    task,
    runEpoch,
    sessionId,
    directory,
    signal,
    isCurrentEpoch,
  }) => {
    const checkCancelled = () => (
      Boolean(signal?.aborted)
      || (isCurrentEpoch && !isCurrentEpoch())
      || isObjectiveStopped(objective.id)
      || store.getTask(task.id)?.runEpoch !== runEpoch
    );

    const renew = (checkpointPatch = undefined, subagentSessionIds = undefined) => {
      store.renewTaskLease(task.id, runEpoch, {
        workerId,
        leaseMs,
        checkpoint: checkpointPatch,
        subagentSessionIds,
        at: now(),
      });
    };

    let idleWaitStart = now();
    let unavailableSince = null;
    if (readSessionStatus) {
      while (now() - idleWaitStart < maxTurnWaitMs) {
        if (checkCancelled()) {
          return { ok: false, aborted: true, kind: 'cancelled', error: 'Objective paused or cancelled while waiting for session' };
        }
        const status = await readSessionStatus(sessionId, directory).catch(() => null);
        if (status === null) {
          if (unavailableSince === null) unavailableSince = now();
          renew();
          if (now() - unavailableSince >= unavailableGraceMs) {
            return {
              ok: false,
              deferred: true,
              kind: 'backend_unavailable',
              nextWakeAt: now() + 5_000,
              error: 'OpenCode backend temporarily unavailable before dispatch',
            };
          }
          await wait(pollIntervalMs, signal);
          continue;
        }
        unavailableSince = null;
        if (status.type === 'idle') break;
        renew(undefined, status.activeChildren);
        idleWaitStart = now();
        await wait(pollIntervalMs, signal);
      }
    }

    if (checkCancelled()) {
      return { ok: false, aborted: true, kind: 'cancelled', error: 'Execution superseded before prompt dispatch' };
    }

    const baseline = readLastAssistantMessage
      ? await readLastAssistantMessage(sessionId, directory).catch(() => null)
      : null;
    const baselineTs = Number(baseline?.completedAt) || 0;
    const baselineId = asNonEmptyString(baseline?.id);
    const baselineAfterIdleId = asNonEmptyString(baseline?.afterIdleId);

    const allTasks = store.listTasks(objective.id);
    const prompt = buildAutonomyTaskPrompt(objective, task, {
      completedTasks: allTasks.filter((t) => t.status === 'completed'),
      pendingTasks: allTasks.filter((t) => t.status === 'pending' || t.status === 'running'),
      failedTasks: allTasks.filter((t) => t.status === 'failed' || t.status === 'blocked'),
      dependencyTasks: (task.dependsOn || [])
        .map((depId) => allTasks.find((t) => t.id === depId))
        .filter((t) => t && t.status === 'completed'),
      latestCheckpoint: store.getLatestCheckpoint({ taskId: task.id }) || store.getLatestCheckpoint({ objectiveId: objective.id }),
      compactionCheckpoint: store.getLatestCheckpoint({ objectiveId: objective.id, kind: 'compaction' }),
      recalledMemories: recallRelevantMemories(objective, task),
      stagnationWarning: objective.stagnationStreak >= 2
        ? `The last ${objective.stagnationStreak} turn(s) produced repetitive or unverified output. Change strategy, inspect concrete code/logs, or run a decisive experiment.`
        : null,
    });

    const preCheckpoint = {
      phase: 'dispatched',
      sessionId,
      directory,
      dispatchedAt: now(),
      baselineMessageId: baselineId,
      afterIdleId: baselineAfterIdleId,
    };
    renew(preCheckpoint);

    let sendResult = null;
    try {
      sendResult = await sessionService.send(sessionId, { directory, prompt });
    } catch (sendErr) {
      const errObj = isRecord(sendErr) ? sendErr : { message: sendErr instanceof Error ? sendErr.message : String(sendErr) };
      if (isLimitError(errObj)) {
        const resetAt = providerLimitResetAt(errObj, now(), task.providerWaits || 0, now(), '') ?? (now() + 15_000);
        executionCoordinator?.noteLimitParked({ sessionId, error: errObj, resetAt, reason: errObj.message });
        return {
          ok: false,
          deferred: true,
          kind: 'usage_limit',
          resetAt,
          checkpoint: preCheckpoint,
          error: asNonEmptyString(errObj.message) || 'Provider usage limit reached on dispatch',
        };
      }
      const errText = asNonEmptyString(errObj.message) || 'Prompt dispatch failed';
      if (TRANSIENT_BACKEND_RE.test(errText)) {
        return {
          ok: false,
          deferred: true,
          kind: 'backend_unavailable',
          nextWakeAt: now() + 5_000,
          checkpoint: preCheckpoint,
          error: errText,
        };
      }
      return { ok: false, kind: 'dispatch_failed', checkpoint: preCheckpoint, error: errText };
    }

    if (sendResult && sendResult.promptDispatched === false) {
      const errText = asNonEmptyString(sendResult.promptError) || 'Session rejected prompt dispatch';
      const syntheticErr = { message: errText };
      if (isLimitError(syntheticErr)) {
        const resetAt = providerLimitResetAt(syntheticErr, now(), task.providerWaits || 0, now(), '') ?? (now() + 15_000);
        executionCoordinator?.noteLimitParked({ sessionId, error: syntheticErr, resetAt, reason: errText });
        return { ok: false, deferred: true, kind: 'usage_limit', resetAt, checkpoint: preCheckpoint, error: errText };
      }
      return { ok: false, kind: 'dispatch_rejected', checkpoint: preCheckpoint, error: errText };
    }

    if (!readSessionStatus && !readLastAssistantMessage) {
      return {
        ok: true,
        confirmed: true,
        result: `Dispatched to session ${sessionId}`,
        checkpoint: { ...preCheckpoint, phase: 'completed', completedAt: now() },
      };
    }

    let seenBusy = false;
    let unconfirmedIdleTicks = 0;
    let lastActiveAt = now();
    unavailableSince = null;
    const maxUnconfirmedIdleTicks = Math.max(6, Math.min(20, Math.ceil(12_000 / Math.max(50, pollIntervalMs))));

    while (now() - lastActiveAt < maxTurnWaitMs) {
      await wait(pollIntervalMs, signal);
      if (checkCancelled()) {
        return { ok: false, aborted: true, kind: 'cancelled', checkpoint: preCheckpoint, error: 'Objective paused or cancelled during turn' };
      }

      if (executionCoordinator) {
        const arb = executionCoordinator.getArbitration(sessionId, 'autonomy', { at: now() });
        if (!arb.allowed && (arb.reason === 'waiting_provider' || arb.reason === 'recovery_active')) {
          return {
            ok: false,
            deferred: true,
            kind: 'usage_limit',
            resetAt: arb.nextWakeAt || (now() + 15_000),
            checkpoint: preCheckpoint,
            error: 'Session parked for automatic provider recovery',
          };
        }
      }

      const status = readSessionStatus
        ? await readSessionStatus(sessionId, directory).catch(() => null)
        : { type: 'idle' };

      if (status === null) {
        if (unavailableSince === null) unavailableSince = now();
        renew(preCheckpoint);
        if (now() - unavailableSince >= unavailableGraceMs) {
          return {
            ok: false,
            deferred: true,
            kind: 'backend_unavailable',
            nextWakeAt: now() + 8_000,
            checkpoint: preCheckpoint,
            error: 'OpenCode backend unreachable during active turn; preserving execution state',
          };
        }
        continue;
      }

      unavailableSince = null;

      if (status.type === 'retry') {
        seenBusy = true;
        unconfirmedIdleTicks = 0;
        lastActiveAt = now();
        renew({
          ...preCheckpoint,
          phase: 'provider_retry',
          retryMessage: status.message,
          nextRetryAt: status.next,
        }, status.activeChildren);
        continue;
      }

      if (status.type === 'busy') {
        seenBusy = true;
        unconfirmedIdleTicks = 0;
        lastActiveAt = now();
        renew({
          ...preCheckpoint,
          phase: 'running',
          lastBusyAt: lastActiveAt,
        }, status.activeChildren);
        continue;
      }

      const latest = readLastAssistantMessage
        ? await readLastAssistantMessage(sessionId, directory).catch(() => null)
        : null;

      const hasNewId = Boolean(latest?.id && latest.id !== baselineId && Number(latest.completedAt) >= baselineTs);
      const hasNewTimestamp = Boolean(latest && Number(latest.completedAt) > baselineTs);
      const hasNewIdleRecord = Boolean(latest?.afterIdleId && latest.afterIdleId !== baselineAfterIdleId);

      if (latest && (hasNewId || hasNewTimestamp || hasNewIdleRecord)) {
        if (latest.isLimit) {
          const resetAt = providerLimitResetAt(
            latest.rawError || { type: 'provider.free-limit', message: latest.error || 'usage limit' },
            now(),
            task.providerWaits || 0,
            latest.completedAt || now(),
            latest.providerID || '',
          ) ?? (now() + 15_000);
          executionCoordinator?.noteLimitParked({
            sessionId,
            providerID: latest.providerID,
            modelID: latest.modelID,
            error: latest.rawError || { message: latest.error },
            resetAt,
            reason: latest.error || 'provider limit',
          });
          return {
            ok: false,
            deferred: true,
            kind: 'usage_limit',
            resetAt,
            checkpoint: { ...preCheckpoint, phase: 'waiting_provider', lastMessageId: latest.id, resetAt },
            error: latest.error || 'Provider usage limit reached',
          };
        }
        if (latest.aborted) {
          return {
            ok: false,
            aborted: true,
            kind: 'aborted',
            checkpoint: { ...preCheckpoint, phase: 'aborted', lastMessageId: latest.id },
            error: 'Assistant turn was interrupted',
          };
        }
        if (latest.failed) {
          return {
            ok: false,
            kind: 'assistant_error',
            checkpoint: { ...preCheckpoint, phase: 'failed', lastMessageId: latest.id },
            error: latest.error || 'Assistant turn failed',
          };
        }

        const cleanResult = stripRecalledContextBlocks(latest.text || '').trim() || 'Completed verified turn';
        const doneCheckpoint = {
          ...preCheckpoint,
          phase: 'completed',
          completedAt: latest.completedAt,
          lastMessageId: latest.id,
        };
        store.saveCheckpoint({
          objectiveId: objective.id,
          taskId: task.id,
          sessionId,
          kind: 'turn_completed',
          summary: cleanResult.slice(0, 600),
          completed: [`${task.title}: ${cleanResult.slice(0, 240)}`],
          afterIdleId: latest.afterIdleId ?? null,
          baselineMessageId: latest.id ?? null,
        });
        return {
          ok: true,
          confirmed: true,
          messageId: latest.id,
          result: cleanResult.slice(0, 4000),
          checkpoint: doneCheckpoint,
        };
      }

      unconfirmedIdleTicks += 1;
      renew(preCheckpoint);
      if ((seenBusy && unconfirmedIdleTicks >= 4) || (!seenBusy && unconfirmedIdleTicks >= maxUnconfirmedIdleTicks)) {
        return {
          ok: false,
          kind: 'unconfirmed_turn',
          checkpoint: { ...preCheckpoint, phase: 'unconfirmed_idle', unconfirmedIdleTicks },
          error: `No confirmed assistant response recorded for session ${sessionId}`,
        };
      }
    }

    return {
      ok: false,
      kind: 'inactivity_timeout',
      checkpoint: { ...preCheckpoint, phase: 'stalled', stalledAt: now() },
      error: `Session ${sessionId} produced no activity for ${Math.round(maxTurnWaitMs / 1000)}s`,
    };
  };

  const executeTask = async (objective, task, execContext = {}) => {
    if (!sessionService?.send) {
      return { ok: false, kind: 'unavailable', error: 'OpenCode session runtime is unavailable' };
    }
    const runEpoch = Number.isFinite(Number(execContext.runEpoch)) ? Number(execContext.runEpoch) : (task.runEpoch ?? 0);
    const parallelCount = Number(execContext.parallelCount) || 1;
    const slotIndex = Number(execContext.slotIndex) || 0;
    const signal = execContext.signal ?? null;

    const { sessionId, directory } = await resolveSessionAndDirectory(objective, task, { parallelCount, slotIndex });
    if (!sessionId) {
      return { ok: false, kind: 'session_resolution_failed', error: 'Failed to resolve or create target chat session' };
    }
    const patch = { sessionId };
    if (isString(directory) && directory !== objective.directory) {
      patch.worktreePath = directory;
    }
    store.updateTaskIfEpoch(task.id, runEpoch, patch);

    if (!executionCoordinator) {
      return runTurnOnSession({
        objective,
        task: store.getTask(task.id) || task,
        runEpoch,
        sessionId,
        directory,
        signal,
        isCurrentEpoch: () => !signal?.aborted,
      });
    }

    const releaseController = executionCoordinator.claimController(sessionId, 'autonomy', {
      objectiveId: objective.id,
      taskId: task.id,
    });
    try {
      const coordinated = await executionCoordinator.runExclusive(sessionId, {
        owner: 'autonomy',
        ownerRef: { objectiveId: objective.id, taskId: task.id },
        lane: 'autonomy',
        directory,
        priority: objective.priority ?? 50,
        signal,
      }, ({ signal: turnSignal, isCurrentEpoch }) => runTurnOnSession({
        objective,
        task: store.getTask(task.id) || task,
        runEpoch,
        sessionId,
        directory,
        signal: turnSignal,
        isCurrentEpoch,
      }));

      if (coordinated.skipped) {
        return {
          ok: false,
          deferred: true,
          kind: coordinated.reason === 'waiting_provider' || coordinated.reason === 'recovery_active'
            ? 'usage_limit'
            : 'yielded',
          resetAt: coordinated.nextWakeAt ?? (now() + 5_000),
          nextWakeAt: coordinated.nextWakeAt ?? (now() + 5_000),
          error: `Deferred (${coordinated.reason})`,
        };
      }
      if (coordinated.stale) {
        return { ok: false, aborted: true, kind: 'superseded', error: 'Turn superseded by newer session epoch' };
      }
      return coordinated.result;
    } catch (coordErr) {
      if (coordErr?.code === 'ABORT_ERR' || signal?.aborted) {
        return { ok: false, aborted: true, kind: 'cancelled', error: 'Task execution aborted' };
      }
      throw coordErr;
    } finally {
      releaseController();
    }
  };

  return { executeTask };
};
