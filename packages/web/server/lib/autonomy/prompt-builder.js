import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { isLimitError } from '../limit-failover/policy.js';
import { stripRecalledContextBlocks, wrapRecalledMemoriesBlock } from './compaction-bridge.js';

const TEXT_LIMIT_HINT_RE = /^(?:(?:opencode\s+failed\s+to\s+send\s+message\s+with\s+)?error:\s*)?(?:you(?:'ve| have)\s+reached|free\s+usage\s+limit|opencode\s+(?:zen|go)\b.*limit|usage\s+limit|daily\s+(?:usage\s+)?limit|weekly\s+(?:usage\s+)?limit|monthly\s+(?:usage\s+)?limit|rate\s+limit\s+(?:exceeded|reached)|quota\s*(?:exceeded|reached|exhausted)|too\s+many\s+requests|insufficient\s+credits|out\s+of\s+credits)/i;

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

const extractActiveSessionEntry = (payload, sessionId) => {
  if (!payload || !sessionId) return { known: false, busy: false, statusObj: null, map: null };
  const inner = isRecord(payload.data)
    ? payload.data
    : (Array.isArray(payload.data) ? payload.data : payload);
  if (Array.isArray(inner)) {
    const found = inner.find((entry) => entry === sessionId || entry?.id === sessionId || entry?.sessionID === sessionId);
    return { known: true, busy: Boolean(found), statusObj: isRecord(found) ? found : null, map: null };
  }
  if (isRecord(inner)) {
    const hasOwn = Object.prototype.hasOwnProperty.call(inner, sessionId);
    const val = hasOwn ? inner[sessionId] : null;
    return { known: true, busy: hasOwn && Boolean(val), statusObj: isRecord(val) ? val : null, map: inner };
  }
  return { known: false, busy: false, statusObj: null, map: null };
};

const normalizeAssistantMessage = (msg) => {
  if (!isRecord(msg)) return null;
  const isV2 = msg.type === 'assistant';
  const isV1 = !isV2 && isRecord(msg.info) && msg.info.role === 'assistant';
  if (!isV2 && !isV1) return null;
  const meta = isV1 ? msg.info : msg;
  const id = asNonEmptyString(meta?.id) || asNonEmptyString(msg?.id) || null;
  const completedNum = Number(meta?.time?.completed);
  const createdNum = Number(meta?.time?.created);
  const finish = asNonEmptyString(meta?.finish);
  const rawError = isRecord(meta?.error) ? meta.error : null;
  const aborted = Boolean(meta?.aborted || rawError?.name === 'MessageAbortedError' || finish === 'aborted');
  const hasError = Boolean(rawError || finish === 'error' || aborted);
  const isDone = (Number.isFinite(completedNum) && completedNum > 0) || Boolean(finish) || hasError;
  if (!isDone) return null;
  const completedAt = (Number.isFinite(completedNum) && completedNum > 0)
    ? completedNum
    : (Number.isFinite(createdNum) && createdNum > 0 ? createdNum : 0);
  if (completedAt <= 0) return null;
  const text = extractAssistantText(msg);
  const textLooksLikeLimit = !rawError && text.length > 0 && text.length <= 420 && TEXT_LIMIT_HINT_RE.test(text);
  const effectiveRawError = rawError || (textLooksLikeLimit ? { type: 'provider.quota', message: text } : null);
  const limitDetected = effectiveRawError ? isLimitError(effectiveRawError) : false;
  const providerID = asNonEmptyString(meta?.model?.providerID)
    || asNonEmptyString(meta?.providerID)
    || '';
  const modelID = asNonEmptyString(meta?.model?.id)
    || asNonEmptyString(meta?.modelID)
    || '';
  return {
    id,
    completedAt,
    text,
    aborted,
    failed: hasError || textLooksLikeLimit,
    isLimit: limitDetected,
    rawError: effectiveRawError,
    providerID,
    modelID,
    compacted: Boolean(meta?.summary === true),
    error: asNonEmptyString(effectiveRawError?.message) || (hasError ? 'Assistant turn failed' : null),
  };
};

export const createOpenCodeSessionAdapter = ({
  readOpenCodeJson,
  activityProbe = null,
} = {}) => {
  const listActiveChildSessions = async (sessionId, activeMap, directory = '') => {
    if (!readOpenCodeJson || !isRecord(activeMap)) return [];
    const children = [];
    for (const candidateId of Object.keys(activeMap)) {
      if (!candidateId || candidateId === sessionId) continue;
      const info = await readOpenCodeJson(`/api/session/${encodeURIComponent(candidateId)}`, directory).catch(() => null);
      const unwrapped = isRecord(info?.data) ? info.data : info;
      const parentId = asNonEmptyString(unwrapped?.parentID) || asNonEmptyString(unwrapped?.parentSessionID);
      if (parentId === sessionId) {
        children.push(candidateId);
      }
    }
    return children;
  };

  const readSessionStatus = async (sessionId, directory) => {
    if (!readOpenCodeJson) return null;
    const active = await readOpenCodeJson('/api/session/active', directory).catch(() => null);
    const extracted = extractActiveSessionEntry(active, sessionId);
    if (!extracted.known) return null;
    if (extracted.busy) {
      const statusType = asNonEmptyString(extracted.statusObj?.type) === 'retry' ? 'retry' : 'busy';
      const activeChildren = extracted.map ? await listActiveChildSessions(sessionId, extracted.map, directory) : [];
      const res = { type: statusType };
      const retryMsg = asNonEmptyString(extracted.statusObj?.message);
      if (retryMsg) res.message = retryMsg;
      if (Number.isFinite(Number(extracted.statusObj?.next))) res.next = Number(extracted.statusObj.next);
      if (activeChildren.length > 0) res.activeChildren = activeChildren;
      return res;
    }

    if (activityProbe) {
      if (extracted.map && Object.keys(extracted.map).length > 0) {
        const descendantsBusy = await Promise.resolve(activityProbe.hasWorkingDescendants(sessionId, extracted.map)).catch(() => false);
        if (descendantsBusy) {
          const activeChildren = await listActiveChildSessions(sessionId, extracted.map, directory);
          const res = { type: 'busy', subagentsWorking: true };
          if (activeChildren.length > 0) res.activeChildren = activeChildren;
          return res;
        }
      }
      const jobs = await Promise.resolve(activityProbe.fetchRunningBackgroundJobs?.(sessionId)).catch(() => null);
      if (Array.isArray(jobs) && jobs.length > 0) {
        return { type: 'busy', backgroundJobsWorking: true };
      }
    }
    return { type: 'idle' };
  };

  const readLastAssistantMessage = async (sessionId, directory) => {
    if (!readOpenCodeJson) return null;
    const page = await readOpenCodeJson(`/api/session/${encodeURIComponent(sessionId)}/message?limit=25`, directory).catch(() => null);
    if (!page) return null;
    const list = Array.isArray(page?.data) ? page.data : (Array.isArray(page) ? page : null);
    if (!list) return null;

    let best = null;
    let latestIdle = null;
    for (const msg of list) {
      if (isRecord(msg) && msg.type === 'idle' && asNonEmptyString(msg.id)) {
        const created = Number(msg?.time?.created) || 0;
        if (!latestIdle || created >= latestIdle.created) {
          latestIdle = {
            id: msg.id,
            outcome: asNonEmptyString(msg.outcome) || 'succeeded',
            created,
            error: isRecord(msg.error) ? msg.error : null,
          };
        }
      }
      const normalized = normalizeAssistantMessage(msg);
      if (!normalized) continue;
      if (!best || normalized.completedAt >= best.completedAt) {
        best = normalized;
      }
    }

    if (!best && latestIdle?.error) {
      const limitErr = isLimitError(latestIdle.error);
      return {
        id: latestIdle.id,
        afterIdleId: latestIdle.id,
        completedAt: latestIdle.created || 1,
        text: '',
        aborted: latestIdle.outcome === 'interrupted',
        failed: true,
        isLimit: limitErr,
        rawError: latestIdle.error,
        providerID: '',
        modelID: '',
        compacted: false,
        error: asNonEmptyString(latestIdle.error.message) || 'Session ended with error',
      };
    }

    if (best && latestIdle) {
      best.afterIdleId = latestIdle.id;
      if (!best.isLimit && latestIdle.error && isLimitError(latestIdle.error)) {
        best.isLimit = true;
        best.failed = true;
        best.rawError = latestIdle.error;
        best.error = asNonEmptyString(latestIdle.error.message) || best.error;
      }
    }
    return best;
  };

  const listSessions = async (limit = 40) => {
    if (!readOpenCodeJson) return [];
    const page = await readOpenCodeJson(`/api/session?limit=${Math.max(1, Math.min(100, Number(limit) || 40))}`, '').catch(() => null);
    const list = Array.isArray(page?.data) ? page.data : (Array.isArray(page) ? page : []);
    return list
      .filter((s) => asNonEmptyString(s?.id))
      .map((s) => ({
        id: s.id,
        title: asNonEmptyString(s.title) || s.id,
        parentID: asNonEmptyString(s.parentID) || null,
        directory: asNonEmptyString(s?.location?.directory) || asNonEmptyString(s?.directory) || '',
        updatedAt: Number(s?.time?.updated) || Number(s?.time?.created) || 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const listChildSessions = async (parentSessionId, directory = '') => {
    const cleanParent = asNonEmptyString(parentSessionId);
    if (!cleanParent || !readOpenCodeJson) return [];
    const active = await readOpenCodeJson('/api/session/active', directory).catch(() => null);
    const extracted = extractActiveSessionEntry(active, cleanParent);
    if (!extracted.map) return [];
    return listActiveChildSessions(cleanParent, extracted.map, directory);
  };

  return { readSessionStatus, readLastAssistantMessage, listSessions, listChildSessions };
};

export const buildAutonomyTaskPrompt = (objective, task, contextOrCompleted = []) => {
  const ctx = Array.isArray(contextOrCompleted)
    ? { completedTasks: contextOrCompleted }
    : (isRecord(contextOrCompleted) ? contextOrCompleted : {});
  const completedTasks = Array.isArray(ctx.completedTasks) ? ctx.completedTasks : [];
  const pendingTasks = Array.isArray(ctx.pendingTasks) ? ctx.pendingTasks : [];
  const failedTasks = Array.isArray(ctx.failedTasks) ? ctx.failedTasks : [];
  const dependencyTasks = Array.isArray(ctx.dependencyTasks) ? ctx.dependencyTasks : [];
  const latestCheckpoint = isRecord(ctx.latestCheckpoint) ? ctx.latestCheckpoint : null;
  const compactionCheckpoint = isRecord(ctx.compactionCheckpoint) ? ctx.compactionCheckpoint : null;
  const recalledMemories = Array.isArray(ctx.recalledMemories) ? ctx.recalledMemories : [];
  const stagnationWarning = asNonEmptyString(ctx.stagnationWarning);

  const lines = [
    `[Autonomy Supervisor — ${objective.mode === 'ongoing' ? 'Ongoing Autonomous' : 'Finite Objective'} Execution]`,
    `Objective: ${objective.title}`,
  ];
  if (asNonEmptyString(objective.description) && objective.description !== objective.title) {
    lines.push(`Goal Specification: ${objective.description}`);
  }
  lines.push(`Current Task: ${task.title} (role: ${task.role}, kind: ${task.kind})`);
  if (asNonEmptyString(task.prompt)) {
    lines.push(`Task Instructions: ${task.prompt}`);
  }
  if (dependencyTasks.length > 0) {
    const depLines = dependencyTasks.map((d) => `- ${d.title}: ${stripRecalledContextBlocks(d.result || 'completed').slice(0, 420)}`);
    lines.push(`Completed Dependency Outputs:\n${depLines.join('\n')}`);
  }
  if (Array.isArray(objective.acceptanceCriteria) && objective.acceptanceCriteria.length > 0) {
    lines.push(`Acceptance Criteria:\n${objective.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`);
  }
  if (Array.isArray(objective.verificationCommands) && objective.verificationCommands.length > 0) {
    lines.push(`Verification Commands:\n${objective.verificationCommands.map((c) => `- ${c}`).join('\n')}`);
  }
  if (asNonEmptyString(task.error)) {
    lines.push(`Previous Attempt Failure (diagnose root cause and adjust approach — do NOT blindly repeat the failing step):\n${task.error}`);
  }
  if (failedTasks.length > 0) {
    const failSummary = failedTasks
      .slice(-3)
      .map((f) => `- ${f.title}: ${String(f.error || 'failed').slice(0, 260)}`);
    lines.push(`Known Blockers / Prior Failed Attempts:\n${failSummary.join('\n')}`);
  }
  if (completedTasks.length > 0) {
    const recent = completedTasks
      .filter((t) => asNonEmptyString(t.result) && t.result !== 'Turn completed')
      .slice(-4)
      .map((t) => `- ${t.title}: ${stripRecalledContextBlocks(t.result).slice(0, 400)}`);
    if (recent.length > 0) {
      lines.push(`Completed & Verified Progress (do NOT redo finished work):\n${recent.join('\n')}`);
    }
  }
  if (pendingTasks.length > 0) {
    const rem = pendingTasks
      .filter((t) => t.id !== task.id)
      .slice(0, 6)
      .map((t) => `- ${t.title} (${t.status})`);
    if (rem.length > 0) {
      lines.push(`Remaining Queued Tasks:\n${rem.join('\n')}`);
    }
  }
  if (compactionCheckpoint && asNonEmptyString(compactionCheckpoint.summary)) {
    lines.push(`Compaction Continuity Anchor (Epoch #${compactionCheckpoint.compactionEpoch || 1}):\n${compactionCheckpoint.summary}`);
  }
  if (latestCheckpoint && latestCheckpoint.id !== compactionCheckpoint?.id && asNonEmptyString(latestCheckpoint.summary)) {
    const nextHint = asNonEmptyString(latestCheckpoint.nextAction) ? `\nNext Action Anchor: ${latestCheckpoint.nextAction}` : '';
    lines.push(`Continuity Checkpoint (${latestCheckpoint.kind}):\n${latestCheckpoint.summary}${nextHint}`);
  }
  const recalledBlock = wrapRecalledMemoriesBlock(recalledMemories);
  if (recalledBlock) {
    lines.push(recalledBlock);
  }
  if (stagnationWarning) {
    lines.push(`Anti-Stagnation Directive: ${stagnationWarning}`);
  }
  lines.push(
    'Scope Guardrail: Stay strictly within your stated goal and the user\'s instructions. Do NOT edit, patch, or try to fix unrelated third-party/reference repositories, vendored folders, or files outside your scope.',
    'Execute concrete, verifiable work on the next unresolved requirement. Use tools/tests to verify outcomes, record durable discoveries via memfs.save when verified, and conclude with exact evidence, touched files, and the next concrete step if work remains.',
  );
  return lines.join('\n\n');
};
