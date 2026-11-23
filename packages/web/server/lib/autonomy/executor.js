import { asNonEmptyString, isRecord } from '../shared/guards.js';

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 900_000;

const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

const extractAssistantText = (message) => {
  const parts = Array.isArray(message?.content)
    ? message.content
    : (Array.isArray(message?.parts) ? message.parts : []);
  return parts
    .filter((p) => p?.type === 'text' && asNonEmptyString(p.text))
    .map((p) => p.text)
    .join('\n')
    .trim();
};

const isSessionInActivePayload = (payload, sessionId) => {
  if (!payload || !sessionId) return null;
  const inner = isRecord(payload.data)
    ? payload.data
    : (Array.isArray(payload.data) ? payload.data : payload);
  if (Array.isArray(inner)) {
    return inner.some((entry) => entry === sessionId || entry?.id === sessionId || entry?.sessionID === sessionId);
  }
  if (isRecord(inner)) {
    return Object.prototype.hasOwnProperty.call(inner, sessionId);
  }
  return null;
};

const normalizeAssistantMessage = (msg) => {
  if (!isRecord(msg)) return null;
  const isV2 = msg.type === 'assistant';
  const isV1 = !isV2 && isRecord(msg.info) && msg.info.role === 'assistant';
  if (!isV2 && !isV1) return null;
  const meta = isV1 ? msg.info : msg;
  const completedNum = Number(meta?.time?.completed);
  const createdNum = Number(meta?.time?.created);
  const finish = asNonEmptyString(meta?.finish);
  const hasError = Boolean(meta?.error || finish === 'error' || meta?.aborted);
  const isDone = (Number.isFinite(completedNum) && completedNum > 0) || Boolean(finish) || hasError;
  if (!isDone) return null;
  const completedAt = (Number.isFinite(completedNum) && completedNum > 0)
    ? completedNum
    : (Number.isFinite(createdNum) && createdNum > 0 ? createdNum : 0);
  if (completedAt <= 0) return null;
  return {
    completedAt,
    text: extractAssistantText(msg),
    failed: hasError,
    error: asNonEmptyString(meta?.error?.message) || (hasError ? 'Assistant turn failed' : null),
  };
};

export const createOpenCodeSessionAdapter = ({
  readOpenCodeJson,
} = {}) => {
  const readSessionStatus = async (sessionId, directory) => {
    if (!readOpenCodeJson) return null;
    const active = await readOpenCodeJson('/api/session/active', directory);
    const busy = isSessionInActivePayload(active, sessionId);
    if (busy === null) return null;
    return busy ? { type: 'busy' } : { type: 'idle' };
  };

  const readLastAssistantMessage = async (sessionId, directory) => {
    if (!readOpenCodeJson) return null;
    const page = await readOpenCodeJson(`/api/session/${encodeURIComponent(sessionId)}/message?limit=15`, directory);
    const list = Array.isArray(page?.data) ? page.data : (Array.isArray(page) ? page : []);
    let best = null;
    for (const msg of list) {
      const normalized = normalizeAssistantMessage(msg);
      if (!normalized) continue;
      if (!best || normalized.completedAt >= best.completedAt) {
        best = normalized;
      }
    }
    return best;
  };

  const listSessions = async (limit = 40) => {
    if (!readOpenCodeJson) return [];
    const page = await readOpenCodeJson(`/api/session?limit=${Math.max(1, Math.min(100, Number(limit) || 40))}`, '');
    const list = Array.isArray(page?.data) ? page.data : (Array.isArray(page) ? page : []);
    return list
      .filter((s) => asNonEmptyString(s?.id))
      .map((s) => ({
        id: s.id,
        title: asNonEmptyString(s.title) || s.id,
        directory: asNonEmptyString(s?.location?.directory) || asNonEmptyString(s?.directory) || '',
        updatedAt: Number(s?.time?.updated) || Number(s?.time?.created) || 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  return { readSessionStatus, readLastAssistantMessage, listSessions };
};

export const buildAutonomyTaskPrompt = (objective, task, completedTasks = []) => {
  const lines = [
    `[Autonomy Supervisor — ${objective.mode === 'ongoing' ? 'Ongoing Research' : 'Objective'} Task]`,
    `Objective: ${objective.title}`,
  ];
  if (asNonEmptyString(objective.description) && objective.description !== objective.title) {
    lines.push(`Goal Details: ${objective.description}`);
  }
  lines.push(`Task: ${task.title} (role: ${task.role}, kind: ${task.kind})`);
  if (asNonEmptyString(task.prompt)) {
    lines.push(`Instructions: ${task.prompt}`);
  }
  if (Array.isArray(objective.acceptanceCriteria) && objective.acceptanceCriteria.length > 0) {
    lines.push(`Acceptance Criteria:\n${objective.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`);
  }
  if (Array.isArray(objective.verificationCommands) && objective.verificationCommands.length > 0) {
    lines.push(`Configured Verification Commands (informational — ignore unrelated/third-party repo failures outside your scope):\n${objective.verificationCommands.map((c) => `- ${c}`).join('\n')}`);
  }
  if (asNonEmptyString(task.error)) {
    lines.push(`Previous Attempt Issue (recover and keep going): ${task.error}`);
  }
  if (completedTasks.length > 0) {
    const recent = completedTasks
      .filter((t) => asNonEmptyString(t.result) && t.result !== 'Turn completed')
      .slice(-2)
      .map((t) => `- ${t.title}: ${t.result.slice(0, 500)}`);
    if (recent.length > 0) {
      lines.push(`Prior Completed Work (continue directly from your stated next step):\n${recent.join('\n')}`);
    }
  }
  lines.push(
    'Scope Guardrail: Stay strictly within your stated goal and the user\'s instructions. Do NOT edit, patch, or try to fix unrelated third-party/reference repositories, vendored folders, or files you were not asked to modify. If any automated check fails on unrelated files, ignore those unrelated failures, note why they are out of scope, and keep working on your actual goal.',
    'Continue working directly in this session without spawning unnecessary extra team chats unless explicitly requested.',
    'Do concrete work on the next unresolved step, verify your findings, use research.search / research.registerSource for docs, and call memfs.save for verified discoveries.',
    'End with concrete verified evidence, files touched, and the exact next concrete step if more work remains.',
  );
  return lines.join('\n\n');
};

export const createAutonomySessionExecutor = ({
  store,
  sessionService = null,
  readSessionStatus = null,
  readLastAssistantMessage = null,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxTurnWaitMs = DEFAULT_MAX_WAIT_MS,
  now = () => Date.now(),
  wait = sleep,
} = {}) => {
  const resolveSession = async (objective) => {
    const existing = asNonEmptyString(objective?.sessionId);
    if (existing) return existing;
    if (!sessionService?.create) return null;
    const created = await sessionService.create({
      directory: objective.directory,
      title: `Autonomy · ${String(objective.title || 'Objective').slice(0, 60)}`,
    });
    const sessionId = asNonEmptyString(created?.sessionId) || asNonEmptyString(created?.id);
    if (sessionId) {
      store.updateObjective(objective.id, { sessionId });
    }
    return sessionId;
  };

  const isObjectiveStopped = (objectiveId) => {
    const current = store.getObjective(objectiveId);
    return !current || current.status === 'paused' || current.status === 'cancelled';
  };

  const executeTask = async (objective, task) => {
    if (!sessionService?.send) {
      return { ok: false, error: 'OpenCode session runtime is unavailable' };
    }
    const sessionId = await resolveSession(objective);
    if (!sessionId) {
      return { ok: false, error: 'Failed to resolve or create target chat session' };
    }
    const directory = objective.directory;
    store.updateTask(task.id, { sessionId });

    const deadline = now() + maxTurnWaitMs;
    if (readSessionStatus) {
      while (now() < deadline) {
        if (isObjectiveStopped(objective.id)) {
          return { ok: false, error: 'Objective paused or cancelled while waiting for session' };
        }
        const status = await readSessionStatus(sessionId, directory).catch(() => null);
        if (status?.type === 'idle') break;
        await wait(pollIntervalMs);
      }
    }

    const baseline = readLastAssistantMessage
      ? await readLastAssistantMessage(sessionId, directory).catch(() => null)
      : null;
    const baselineTs = Number(baseline?.completedAt) || 0;

    const completedTasks = store.listTasks(objective.id).filter((t) => t.status === 'completed');
    const prompt = buildAutonomyTaskPrompt(objective, task, completedTasks);
    const sendResult = await sessionService.send(sessionId, { directory, prompt });
    if (sendResult && sendResult.promptDispatched === false) {
      return { ok: false, error: asNonEmptyString(sendResult.promptError) || 'Session rejected prompt dispatch' };
    }

    if (!readSessionStatus && !readLastAssistantMessage) {
      return { ok: true, result: `Dispatched to session ${sessionId}` };
    }

    let seenBusy = false;
    let idleTicks = 0;
    while (now() < deadline) {
      await wait(pollIntervalMs);
      if (isObjectiveStopped(objective.id)) {
        return { ok: false, error: 'Objective paused or cancelled during turn' };
      }
      const status = readSessionStatus
        ? await readSessionStatus(sessionId, directory).catch(() => null)
        : { type: 'idle' };
      if (!status || status.type === 'busy') {
        if (status?.type === 'busy') seenBusy = true;
        idleTicks = 0;
        store.updateTask(task.id, { heartbeatAt: now() });
        continue;
      }
      const latest = readLastAssistantMessage
        ? await readLastAssistantMessage(sessionId, directory).catch(() => null)
        : null;
      if (latest && Number(latest.completedAt) > baselineTs) {
        if (latest.failed) {
          return { ok: false, error: latest.error || 'Assistant turn failed' };
        }
        return { ok: true, result: (latest.text || 'Turn completed').slice(0, 4000) };
      }
      idleTicks += 1;
      if ((seenBusy && idleTicks >= 4) || (!seenBusy && idleTicks >= 45)) {
        return { ok: true, result: latest?.text?.slice(0, 4000) || `Session ${sessionId} completed turn` };
      }
    }
    return { ok: false, error: `Timed out waiting for session ${sessionId} to finish turn` };
  };

  return { executeTask };
};
