import crypto from 'node:crypto';

import { parseLimitResetAt } from '../limit-failover/policy.js';
import { buildResumePrompt, decideRecovery, isExternalTool } from './reconciler.js';

const LEASE_TTL_MS = 60_000;
const LEASE_RENEW_MS = 20_000;
const CONNECT_DEBOUNCE_MS = 2_000;
const RETRY_BASE_MS = 30_000;
const PROVIDER_WAIT_MS = 15 * 60_000;
const CHILD_DEFER_MS = 15_000;
const MESSAGE_FETCH_LIMIT = 60;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asText = (value) => (typeof value === 'string' ? value : '');

const limitFailureOf = (error, now) => {
  const status = Number(error?.status) || 0;
  const message = asText(error?.message);
  if (status !== 429 && !/quota|rate limit|usage limit|too many requests/i.test(message)) return null;
  return parseLimitResetAt({ retryAfterMs: error?.retryAfterMs, body: error?.body }, now) ?? now + PROVIDER_WAIT_MS;
};

const summarizeChild = (session, messages) => {
  const assistant = Array.isArray(messages)
    ? [...messages].reverse().find((message) => message?.type === 'assistant')
    : null;
  const text = Array.isArray(assistant?.content)
    ? assistant.content.filter((part) => part?.type === 'text').map((part) => part.text).join(' ')
    : '';
  return {
    sessionID: session.id,
    state: asText(session.outcome) || 'unknown',
    summary: text.trim() || asText(session.title) || 'no assistant summary',
  };
};

export const createSessionRecoveryRuntime = ({
  store,
  openCodeFetch,
  globalEventHub = null,
  broadcastEvent = () => {},
  now = Date.now,
  owner = `${process.pid}-${crypto.randomUUID()}`,
  leaseTtlMs = LEASE_TTL_MS,
  leaseRenewMs = LEASE_RENEW_MS,
  maxAttempts = 2,
  resumeConcurrency = 2,
  connectDebounceMs = CONNECT_DEBOUNCE_MS,
  pollMs = 30_000,
  startGraceMs = 10_000,
}) => {
  const runtimeStartedAt = now();
  let stopped = false;
  let hasLease = false;
  let reconcileTimer = null;
  let heartbeatTimer = null;
  let pollTimer = null;
  let reconcilePromise = null;
  const unsubscribers = [];

  const backoffFor = (attempts) => RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1));

  const broadcastSummary = (detail) => {
    broadcastEvent({ type: 'spleen:recovery', properties: { ...status(), ...detail } });
  };

  const status = () => {
    const rows = store.all();
    const counts = {};
    for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
    return {
      coordinator: hasLease,
      counts,
      sessions: rows.slice(0, 50).map((row) => ({
        sessionID: row.session_id,
        parentSessionID: row.parent_session_id,
        state: row.state,
        attempts: row.attempts,
        nextWakeAt: row.next_wake_at,
        reason: row.last_error || null,
      })),
    };
  };

  const renewLease = () => {
    if (stopped) return;
    const held = hasLease;
    hasLease = store.renewLease(owner, leaseTtlMs, now());
    if (!held && hasLease && !reconcileTimer) scheduleReconcile(0);
  };

  const takeLease = () => {
    hasLease = store.tryAcquireLease(owner, leaseTtlMs, now());
    return hasLease;
  };

  const handleEvent = (event) => {
    const payload = isRecord(event?.payload) ? event.payload : event;
    const type = asText(payload?.type);
    const data = isRecord(payload?.data) ? payload.data : {};
    const sessionID = asText(data.sessionID);
    if (!sessionID) return;
    const directory = asText(event?.directory) || asText(data.directory);
    const seq = Number.isFinite(payload?.durable?.seq) ? payload.durable.seq : null;
    const at = now();

    switch (type) {
      case 'session.execution.started':
        store.beginExecution({ sessionID, directory: directory || null, seq, at });
        break;
      case 'session.execution.succeeded':
        store.finish(sessionID, 'completed', { at });
        break;
      case 'session.execution.failed': {
        const error = isRecord(data.error) ? data.error : {};
        store.finish(sessionID, 'failed', { at, error: asText(error.name) || asText(error.type) || 'failed' });
        break;
      }
      case 'session.execution.interrupted': {
        const reason = asText(data.reason) || 'user';
        if (reason === 'user') store.finish(sessionID, 'completed', { at });
        else store.schedule(sessionID, {
          state: 'recovering',
          attempts: Number(store.get(sessionID)?.attempts) || 0,
          nextWakeAt: at + CHILD_DEFER_MS,
          at,
          error: `interrupted:${reason}`,
        });
        break;
      }
      case 'session.tool.called':
        store.noteTool({
          sessionID,
          toolID: asText(data.id),
          name: asText(data.native?.name) || asText(data.name) || 'tool',
          input: isRecord(data.input) ? data.input : null,
          status: data.executed ? 'running' : 'called',
          executed: data.executed === true,
          external: isExternalTool(data.native?.name || data.name),
          at,
        });
        break;
      case 'session.tool.success':
        store.noteTool({
          sessionID,
          toolID: asText(data.id),
          name: asText(data.native?.name) || 'tool',
          status: 'completed',
          executed: true,
          at,
        });
        store.noteEvent(sessionID, seq, at);
        break;
      case 'session.tool.failed':
        store.noteTool({
          sessionID,
          toolID: asText(data.id),
          name: asText(data.native?.name) || 'tool',
          status: 'failed',
          executed: true,
          at,
        });
        break;
      default:
        return;
    }
    store.noteEvent(sessionID, seq, at);
  };

  const fetchActiveMap = async () => {
    const active = await openCodeFetch('/api/session/active');
    if (!isRecord(active)) throw new Error('active sessions response is not an object');
    return active;
  };

  const fetchSession = async (sessionID, directory) => {
    try {
      const session = await openCodeFetch(`/api/session/${encodeURIComponent(sessionID)}`, { directory });
      return isRecord(session) ? session : null;
    } catch {
      return null;
    }
  };

  const fetchMessages = async (sessionID, directory) => {
    try {
      const page = await openCodeFetch(`/api/session/${encodeURIComponent(sessionID)}/message`, {
        directory,
        query: { limit: String(MESSAGE_FETCH_LIMIT) },
      });
      const messages = isRecord(page) ? page.data : page;
      return Array.isArray(messages) ? messages : null;
    } catch {
      return null;
    }
  };

  const childResultsOf = async (sessionID) => {
    const children = store.all().filter((row) => row.parent_session_id === sessionID && !store.isTerminal(row.state));
    const results = [];
    for (const child of children.slice(0, 8)) {
      const session = await fetchSession(child.session_id, child.directory);
      if (!session) continue;
      const messages = await fetchMessages(child.session_id, child.directory);
      results.push(summarizeChild(session, messages));
    }
    return results;
  };

  const sendResume = async (row, decision) => {
    const sessionID = row.session_id;
    const directory = row.directory || null;
    const childResults = await childResultsOf(sessionID);
    const body = buildResumePrompt({
      sessionID,
      executionSeq: row.execution_seq,
      attempt: decision.attempt,
      tail: decision.tail,
      childResults,
    });
    try {
      const inbox = await openCodeFetch(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
        directory,
        method: 'POST',
        body,
      });
      const resumeMessageID = asText(inbox?.id) || null;
      store.schedule(sessionID, {
        state: 'recovering',
        attempts: decision.attempt,
        nextWakeAt: now() + 30_000,
        resumeMessageID,
        at: now(),
      });
      store.noteRecovery('resume.sent', sessionID, { attempt: decision.attempt, resumeMessageID }, now());
      broadcastSummary({ resumed: sessionID });
      return true;
    } catch (error) {
      const at = now();
      const limitResetAt = limitFailureOf(error, at);
      if (limitResetAt !== null) {
        store.schedule(sessionID, {
          state: 'waiting_provider',
          attempts: decision.attempt,
          nextWakeAt: limitResetAt,
          error: 'provider limit',
          at,
        });
      } else {
        store.schedule(sessionID, {
          state: 'recovering',
          attempts: decision.attempt,
          nextWakeAt: at + backoffFor(decision.attempt),
          error: asText(error?.message) || 'resume failed',
          at,
        });
      }
      console.warn(`[session-recovery] resume ${sessionID} failed: ${error?.message || error}`);
      return false;
    }
  };

  const reconcileRow = async (row, activeMap, pendingIDs) => {
    const sessionID = row.session_id;
    const directory = row.directory || null;
    const session = await fetchSession(sessionID, directory);
    const messages = session ? await fetchMessages(sessionID, directory) : null;
    const decision = decideRecovery({
      row,
      active: Boolean(activeMap[sessionID]),
      session,
      messages,
      now: now(),
      maxAttempts,
    });

    switch (decision.action) {
      case 'attach':
        store.schedule(sessionID, { state: 'running', attempts: Number(row.attempts) || 0, at: now() });
        break;
      case 'complete':
        store.finish(sessionID, decision.state, { at: now(), error: decision.reason });
        break;
      case 'needs_review':
        store.markNeedsReview(sessionID, decision.reason, now());
        break;
      case 'wait':
        store.schedule(sessionID, {
          state: decision.state,
          attempts: Number(row.attempts) || 0,
          nextWakeAt: decision.nextWakeAt ?? now() + 15_000,
          at: now(),
          error: decision.reason,
        });
        break;
      case 'resume':
        if (now() - runtimeStartedAt < startGraceMs) {
          store.schedule(sessionID, {
            state: 'recovering',
            attempts: Number(row.attempts) || 0,
            nextWakeAt: now() + Math.max(1_000, startGraceMs - (now() - runtimeStartedAt)),
            at: now(),
            error: 'waiting for backend startup',
          });
          break;
        }
        if (row.parent_session_id && pendingIDs.has(row.parent_session_id)) {
          store.schedule(sessionID, {
            state: 'waiting_parent',
            attempts: Number(row.attempts) || 0,
            nextWakeAt: now() + CHILD_DEFER_MS,
            at: now(),
          });
          break;
        }
        await sendResume(row, decision);
        break;
      default:
        break;
    }
  };

  const runReconcile = async () => {
    if (stopped || !hasLease) return;
    const rows = store.pending();
    if (rows.length === 0) {
      broadcastSummary({ reconciled: true });
      return;
    }

    let activeMap;
    try {
      activeMap = await fetchActiveMap();
    } catch (error) {
      console.warn(`[session-recovery] active read failed: ${error?.message || error}`);
      for (const row of rows) {
        store.schedule(row.session_id, {
          state: row.state === 'running' ? 'unknown' : row.state,
          attempts: Number(row.attempts) || 0,
          nextWakeAt: now() + 15_000,
          at: now(),
          error: 'active read failed',
        });
      }
      return;
    }

    const pendingIDs = new Set(rows.map((row) => row.session_id));
    const queue = [...rows];
    const workers = Array.from({ length: Math.max(1, Math.min(resumeConcurrency, queue.length)) }, async () => {
      while (queue.length > 0 && !stopped) {
        const row = queue.shift();
        try {
          await reconcileRow(row, activeMap, pendingIDs);
        } catch (error) {
          console.warn(`[session-recovery] reconcile ${row.session_id} failed: ${error?.message || error}`);
        }
      }
    });
    await Promise.all(workers);
    broadcastSummary({ reconciled: true });
  };

  const reconcile = () => {
    if (stopped || !hasLease) return Promise.resolve();
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = runReconcile().finally(() => {
      reconcilePromise = null;
    });
    return reconcilePromise;
  };

  const scheduleReconcile = (delayMs = 0) => {
    if (stopped || reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      void reconcile();
    }, delayMs);
    reconcileTimer.unref?.();
  };

  const start = () => {
    stopped = false;
    if (!takeLease()) {
      console.log('[session-recovery] another coordinator holds the lease; observing only');
    }
    heartbeatTimer = setInterval(renewLease, leaseRenewMs);
    heartbeatTimer.unref?.();
    pollTimer = setInterval(() => scheduleReconcile(0), pollMs);
    pollTimer.unref?.();
    if (globalEventHub) {
      unsubscribers.push(globalEventHub.subscribeEvent(handleEvent));
      unsubscribers.push(globalEventHub.subscribeStatus((statusEvent) => {
        if (statusEvent?.type === 'connect') scheduleReconcile(connectDebounceMs);
      }));
    }
    if (hasLease) scheduleReconcile(0);
    return { hasLease };
  };

  const stop = () => {
    stopped = true;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearInterval(pollTimer);
    reconcileTimer = null;
    heartbeatTimer = null;
    pollTimer = null;
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // already detached
      }
    }
    if (hasLease) store.releaseLease(owner);
    hasLease = false;
  };

  return {
    start,
    stop,
    handleEvent,
    reconcile,
    status,
    get hasLease() {
      return hasLease;
    },
  };
};
