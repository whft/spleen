import { asNonEmptyString, isRecord } from '../shared/guards.js';

export const RECALLED_OPEN_TAG = '<spleen-recalled-context>';
export const RECALLED_CLOSE_TAG = '</spleen-recalled-context>';

export const stripRecalledContextBlocks = (text) => {
  const raw = String(text ?? '');
  if (!raw.includes(RECALLED_OPEN_TAG)) return raw;
  return raw.replace(/<spleen-recalled-context>[\s\S]*?<\/spleen-recalled-context>/gi, '').trim();
};

export const wrapRecalledMemoriesBlock = (memories = []) => {
  const valid = (Array.isArray(memories) ? memories : [])
    .filter((m) => isRecord(m) && asNonEmptyString(m.title) && asNonEmptyString(m.body))
    .slice(0, 6);
  if (valid.length === 0) return '';
  const lines = valid.map((m) => {
    const badge = m.verificationStatus === 'verified' ? 'verified' : m.tier || 'note';
    return `- [${badge}] ${m.title}: ${String(m.body).slice(0, 320)}`;
  });
  return [
    RECALLED_OPEN_TAG,
    'Prior Verified Project Knowledge (reference only — do not re-save verbatim):',
    ...lines,
    RECALLED_CLOSE_TAG,
  ].join('\n');
};

const isCompactionEvent = (event) => {
  const payload = isRecord(event?.payload) ? event.payload : event;
  const type = asNonEmptyString(payload?.type) || '';
  if (type.includes('compaction') || type === 'session.compacted') return true;
  const info = isRecord(payload?.properties?.info)
    ? payload.properties.info
    : (isRecord(payload?.data?.info) ? payload.data.info : payload?.data);
  return isRecord(info) && (info.summary === true || info.type === 'compaction');
};

const extractEventSessionId = (event) => {
  const payload = isRecord(event?.payload) ? event.payload : event;
  const props = isRecord(payload?.properties) ? payload.properties : {};
  const data = isRecord(payload?.data) ? payload.data : {};
  const info = isRecord(props.info) ? props.info : (isRecord(data.info) ? data.info : {});
  return (
    asNonEmptyString(props.sessionID)
    || asNonEmptyString(data.sessionID)
    || asNonEmptyString(info.sessionID)
    || asNonEmptyString(info.id)
    || null
  );
};

export const createCompactionBridge = ({
  autonomyStore,
  memfsStore = null,
  globalEventHub = null,
  broadcastEvent = null,
  now = () => Date.now(),
} = {}) => {
  const unsubscribers = [];
  const lastRecordedBySession = new Map();

  const recordCompactionCheckpoint = (sessionId, { summaryText = '' } = {}) => {
    const cleanSession = asNonEmptyString(sessionId);
    if (!cleanSession || !autonomyStore) return null;
    const at = now();
    const prevAt = lastRecordedBySession.get(cleanSession) ?? 0;
    if (at - prevAt < 2_000) return null;

    const matchingTasks = autonomyStore.listTasksBySession(cleanSession);
    const DirectObjectives = autonomyStore.listObjectives({ sessionId: cleanSession, limit: 10 });
    const targetObjective = DirectObjectives.find((o) => o.status === 'active' || o.status === 'waiting')
      || (matchingTasks[0] ? autonomyStore.getObjective(matchingTasks[0].objectiveId) : null);
    if (!targetObjective) return null;

    lastRecordedBySession.set(cleanSession, at);
    const allTasks = autonomyStore.listTasks(targetObjective.id);
    const runningTask = allTasks.find((t) => t.status === 'running' && t.sessionId === cleanSession)
      || allTasks.find((t) => t.status === 'running')
      || null;
    const completed = allTasks
      .filter((t) => t.status === 'completed')
      .slice(-8)
      .map((t) => `${t.title}: ${String(t.result || 'completed').slice(0, 240)}`);
    const remaining = allTasks
      .filter((t) => t.status === 'pending' || t.status === 'running')
      .map((t) => `${t.title} (${t.status})`);
    const failed = allTasks
      .filter((t) => t.status === 'failed' || t.status === 'blocked' || asNonEmptyString(t.error))
      .slice(-5)
      .map((t) => `${t.title}: ${String(t.error || 'failed').slice(0, 220)}`);
    const prior = autonomyStore.getLatestCheckpoint({ objectiveId: targetObjective.id });
    const nextEpoch = (prior?.compactionEpoch ?? 0) + 1;
    const cleanSummary = stripRecalledContextBlocks(summaryText).slice(0, 1000)
      || `Context compacted (epoch #${nextEpoch}) while working on "${runningTask?.title || targetObjective.title}"`;

    const checkpoint = autonomyStore.saveCheckpoint({
      objectiveId: targetObjective.id,
      taskId: runningTask?.id ?? null,
      sessionId: cleanSession,
      kind: 'compaction',
      summary: cleanSummary,
      completed,
      remaining,
      failed,
      nextAction: runningTask ? `Resume "${runningTask.title}" without repeating completed steps` : `Continue "${targetObjective.title}"`,
      compactionEpoch: nextEpoch,
    });

    autonomyStore.recordDecision({
      objectiveId: targetObjective.id,
      taskId: runningTask?.id ?? null,
      kind: 'checkpoint',
      summary: `Saved compaction continuity checkpoint #${nextEpoch} for session ${cleanSession}`,
      details: { checkpointId: checkpoint?.id, compactionEpoch: nextEpoch },
    });

    if (memfsStore && cleanSummary) {
      try {
        memfsStore.saveMemory({
          tier: 'episodic',
          scope: 'project',
          scopeId: targetObjective.directory || '',
          title: `Compaction Snapshot #${nextEpoch}: ${targetObjective.title.slice(0, 90)}`,
          body: [
            cleanSummary,
            completed.length > 0 ? `Completed:\n${completed.map((c) => `- ${c}`).join('\n')}` : '',
            remaining.length > 0 ? `Remaining:\n${remaining.map((r) => `- ${r}`).join('\n')}` : '',
          ].filter(Boolean).join('\n\n'),
          tags: ['compaction', 'checkpoint'],
          confidence: 0.75,
          verificationStatus: 'unverified',
          originClass: 'agent',
          sessionKind: 'autonomy',
          supersessionKey: `compaction:${targetObjective.id}`,
          sources: [{ kind: 'session', ref: cleanSession }],
          reason: 'pre/post compaction continuity flush',
        });
      } catch {}
    }

    if (broadcastEvent) {
      try {
        broadcastEvent({
          type: 'autonomy:compaction_checkpoint',
          objectiveId: targetObjective.id,
          sessionId: cleanSession,
          compactionEpoch: nextEpoch,
          timestamp: at,
        });
      } catch {}
    }
    return checkpoint;
  };

  const handleEvent = (event) => {
    if (!isCompactionEvent(event)) return;
    const sessionId = extractEventSessionId(event);
    if (!sessionId) return;
    const payload = isRecord(event?.payload) ? event.payload : event;
    const summaryText = asNonEmptyString(payload?.data?.summary) || asNonEmptyString(payload?.properties?.summary) || '';
    recordCompactionCheckpoint(sessionId, { summaryText });
  };

  const start = () => {
    if (!globalEventHub) return;
    unsubscribers.push(globalEventHub.subscribeEvent(handleEvent));
    if (globalEventHub.subscribeTranslated) {
      unsubscribers.push(globalEventHub.subscribeTranslated(handleEvent));
    }
  };

  const stop = () => {
    for (const unsub of unsubscribers.splice(0)) {
      try { unsub(); } catch {}
    }
  };

  return {
    start,
    stop,
    handleEvent,
    recordCompactionCheckpoint,
  };
};
