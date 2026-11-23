import { asNonEmptyString } from '../shared/guards.js';

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 900_000;

const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

const extractAssistantText = (message) => {
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts
    .filter((p) => p?.type === 'text' && asNonEmptyString(p.text))
    .map((p) => p.text)
    .join('')
    .trim();
};

export const createOpenCodeSessionAdapter = ({
  readOpenCodeJson,
} = {}) => {
  const readSessionStatus = async (sessionId, directory) => {
    if (!readOpenCodeJson) return null;
    const active = await readOpenCodeJson('/api/session/active', directory);
    if (!active) return null;
    return active[sessionId] ? { type: 'busy' } : { type: 'idle' };
  };

  const readLastAssistantMessage = async (sessionId, directory) => {
    if (!readOpenCodeJson) return null;
    const page = await readOpenCodeJson(`/api/session/${encodeURIComponent(sessionId)}/message?limit=15`, directory);
    const list = Array.isArray(page?.data) ? page.data : (Array.isArray(page) ? page : []);
    let lastAssistant = null;
    let bestTs = -1;
    for (const msg of list) {
      if (msg?.type !== 'assistant') continue;
      const ts = Number(msg?.time?.completed) || Number(msg?.time?.created) || 0;
      if (ts >= bestTs) {
        bestTs = ts;
        lastAssistant = msg;
      }
    }
    if (!lastAssistant || bestTs <= 0) return null;
    const text = extractAssistantText(lastAssistant);
    const failed = Boolean(lastAssistant.error || lastAssistant.finish === 'error' || lastAssistant.aborted);
    return {
      completedAt: bestTs,
      text,
      failed,
      error: asNonEmptyString(lastAssistant.error?.message) || (failed ? 'Assistant turn failed' : null),
    };
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
    lines.push(`Verification Commands:\n${objective.verificationCommands.map((c) => `- ${c}`).join('\n')}`);
  }
  if (completedTasks.length > 0) {
    const recent = completedTasks.slice(-4).map((t) => `- ${t.title}: ${(t.result || 'completed').slice(0, 240)}`);
    lines.push(`Prior Completed Work:\n${recent.join('\n')}`);
  }
  lines.push(
    'Execute this step directly in this session without spawning unnecessary extra team chats unless explicitly requested.',
    'Use research.search / research.registerSource for local docs and memfs.save to persist verified discoveries.',
    'Report concrete verified evidence, files touched, or genuine blockers clearly at the end of your turn.',
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
        if (!status || status.type === 'idle') break;
        await wait(pollIntervalMs);
      }
    }

    const baseline = readLastAssistantMessage
      ? await readLastAssistantMessage(sessionId, directory).catch(() => null)
      : null;
    const baselineTs = Number(baseline?.completedAt) || 0;

    const completedTasks = store.listTasks(objective.id).filter((t) => t.status === 'completed');
    const prompt = buildAutonomyTaskPrompt(objective, task, completedTasks);
    await sessionService.send({ sessionId, directory, prompt });

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
      if (status?.type === 'busy') {
        seenBusy = true;
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
      if ((seenBusy && idleTicks >= 3) || (!seenBusy && idleTicks >= 15)) {
        return { ok: true, result: latest?.text?.slice(0, 4000) || `Session ${sessionId} completed turn` };
      }
    }
    return { ok: false, error: `Timed out waiting for session ${sessionId} to finish turn` };
  };

  return { executeTask };
};
