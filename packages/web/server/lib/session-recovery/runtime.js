import crypto from 'node:crypto';

import { isLimitError, isLimitErrorType } from '../limit-failover/policy.js';
import { sessionParentId } from '../session-lineage.js';
import { buildResumePrompt, decideRecovery, isExternalTool, providerLimitResetAt } from './reconciler.js';

const LEASE_TTL_MS = 60_000;
const LEASE_RENEW_MS = 20_000;
const CONNECT_DEBOUNCE_MS = 2_000;
const RETRY_BASE_MS = 30_000;
const CHILD_DEFER_MS = 15_000;
const CHILD_MAX_DEFER_MS = 5 * 60_000;
const REVIVE_LIMIT_MS = 35 * 24 * 60 * 60_000;
const REVIVE_STAGGER_MS = 30_000;
const MESSAGE_FETCH_LIMIT = 60;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asText = (value) => (typeof value === 'string' ? value : '');

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
  const manualWakeIds = new Set();
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
        directory: row.directory || null,
        state: row.state,
        attempts: row.attempts,
        providerWaits: row.provider_waits ?? 0,
        nextWakeAt: row.next_wake_at,
        resumedAt: row.resumed_at ?? null,
        updatedAt: row.updated_at ?? null,
        reason: row.last_error || null,
      })),
    };
  };

  const reviveLimitFailures = () => {
    const at = now();
    let revived = 0;
    for (const row of store.failedSince(at - REVIVE_LIMIT_MS)) {
      if (!isLimitErrorType(row.last_error) && !isLimitError({ type: row.last_error, message: row.last_error })) continue;
      store.schedule(row.session_id, {
        state: 'waiting_provider',
        attempts: 0,
        providerWaits: 0,
        nextWakeAt: at + revived * REVIVE_STAGGER_MS,
        error: 'provider limit',
        at,
      });
      revived += 1;
    }
  };

  const renewLease = () => {
    if (stopped) return;
    const held = hasLease;
    hasLease = store.renewLease(owner, leaseTtlMs, now());
    if (!held && hasLease) {
      reviveLimitFailures();
      if (!reconcileTimer) scheduleReconcile(0);
    }
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
        const row = store.get(sessionID);
        const attempts = Number(row?.attempts) || 0;
        const limitResetAt = providerLimitResetAt(error, at, Number(row?.provider_waits) || 0);
        if (limitResetAt !== null) {
          if (!row) store.beginExecution({ sessionID, directory: directory || null, seq, at });
          store.schedule(sessionID, {
            state: 'waiting_provider',
            attempts,
            nextWakeAt: limitResetAt,
            error: 'provider limit',
            at,
          });
          broadcastSummary({ parked: sessionID });
          break;
        }
        store.finish(sessionID, 'failed', {
          at,
          error: asText(error.type) || asText(error.name) || asText(error.code) || asText(error.message) || 'failed',
        });
        break;
      }
      case 'session.error': {
        const error = isRecord(data.error) ? data.error : {};
        const row = store.get(sessionID);
        const limitResetAt = providerLimitResetAt(error, at, Number(row?.provider_waits) || 0);
        if (limitResetAt !== null) {
          if (!row) store.beginExecution({ sessionID, directory: directory || null, seq, at });
          store.schedule(sessionID, {
            state: 'waiting_provider',
            attempts: Number(row?.attempts) || 0,
            nextWakeAt: limitResetAt,
            error: 'provider limit',
            at,
          });
          broadcastSummary({ parked: sessionID });
        }
        break;
      }
      case 'session.status': {
        const statusInfo = isRecord(data.status) ? data.status : data;
        if (asText(statusInfo?.type) !== 'retry') return;
        const message = asText(statusInfo.message);
        const row = store.get(sessionID);
        const error = { message, retryAfterMs: Number.isFinite(statusInfo.next) && statusInfo.next > at ? statusInfo.next - at : undefined };
        const limitResetAt = providerLimitResetAt(error, at, Number(row?.provider_waits) || 0);
        if (limitResetAt !== null) {
          if (!row) store.beginExecution({ sessionID, directory: directory || null, seq, at });
          store.schedule(sessionID, {
            state: 'waiting_provider',
            attempts: Number(row?.attempts) || 0,
            nextWakeAt: limitResetAt,
            error: 'provider limit',
            at,
          });
          broadcastSummary({ parked: sessionID });
        }
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
    } catch (error) {
      if (Number(error?.status) === 404) return null;
      throw error;
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

  const sendResume = async (row, decision) => {
    const sessionID = row.session_id;
    const directory = row.directory || null;
    const body = buildResumePrompt({
      sessionID,
      executionSeq: row.execution_seq,
      attempt: decision.attempt,
    });
    try {
      const inbox = await openCodeFetch(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
        directory,
        method: 'POST',
        body,
      });
      const resumeMessageID = asText(inbox?.id) || null;
      const sentAt = now();
      store.schedule(sessionID, {
        state: 'recovering',
        attempts: decision.attempt,
        nextWakeAt: sentAt + 30_000,
        resumeMessageID,
        providerWaits: decision.afterLimit ? (Number(row.provider_waits) || 0) + 1 : null,
        resumedAt: sentAt,
        at: sentAt,
      });
      store.noteRecovery('resume.sent', sessionID, { attempt: decision.attempt, resumeMessageID }, sentAt);
      broadcastSummary({ resumed: sessionID });
      return true;
    } catch (error) {
      const at = now();
      const waits = (Number(row.provider_waits) || 0) + 1;
      const limitResetAt = providerLimitResetAt(error, at, waits);
      if (limitResetAt !== null) {
        store.schedule(sessionID, {
          state: 'waiting_provider',
          attempts: decision.attempt,
          providerWaits: waits,
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

  const reconcileRow = async (row, activeMap, pendingByID) => {
    const sessionID = row.session_id;
    const directory = row.directory || null;
    const storedParent = row.parent_session_id && row.parent_session_id !== sessionID
      ? pendingByID.get(row.parent_session_id)
      : null;
    const deferToParent = (parent) => {
      const at = now();
      const parentWake = Number(parent.next_wake_at) || 0;
      store.schedule(sessionID, {
        state: 'waiting_parent',
        attempts: Number(row.attempts) || 0,
        nextWakeAt: Math.min(Math.max(at + CHILD_DEFER_MS, parentWake), at + CHILD_MAX_DEFER_MS),
        at,
      });
    };
    if (storedParent && !activeMap[sessionID]) {
      deferToParent(storedParent);
      return;
    }

    const session = await fetchSession(sessionID, directory);
    const messages = session ? await fetchMessages(sessionID, directory) : null;
    const parentSessionID = sessionParentId(session) || row.parent_session_id || null;
    if (session && parentSessionID && parentSessionID !== row.parent_session_id) {
      store.noteParent(sessionID, parentSessionID, now());
    }
    const decision = decideRecovery({
      row: { ...row, parent_session_id: parentSessionID },
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
      case 'park':
        store.schedule(sessionID, {
          state: 'waiting_provider',
          attempts: Number(row.attempts) || 0,
          nextWakeAt: decision.nextWakeAt,
          at: now(),
          error: decision.reason,
        });
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
        if (!manualWakeIds.delete(sessionID) && now() - runtimeStartedAt < startGraceMs) {
          store.schedule(sessionID, {
            state: 'recovering',
            attempts: Number(row.attempts) || 0,
            nextWakeAt: now() + Math.max(1_000, startGraceMs - (now() - runtimeStartedAt)),
            at: now(),
            error: 'waiting for backend startup',
          });
          break;
        }
        if (parentSessionID && pendingByID.has(parentSessionID)) {
          deferToParent(pendingByID.get(parentSessionID));
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
    const at = now();
    const pendingRows = store.pending();
    const rows = pendingRows.filter((row) => !(Number(row.next_wake_at) > at));
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

    const pendingByID = new Map(pendingRows.map((row) => [row.session_id, row]));
    const queue = [...rows];
    const workers = Array.from({ length: Math.max(1, Math.min(resumeConcurrency, queue.length)) }, async () => {
      while (queue.length > 0 && !stopped) {
        const row = queue.shift();
        try {
          await reconcileRow(row, activeMap, pendingByID);
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
    if (hasLease) {
      reviveLimitFailures();
      scheduleReconcile(0);
    }
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

  const resumeNow = async (sessionID) => {
    const id = asText(sessionID).trim();
    if (!id) return { ok: false, reason: 'invalid_session' };
    const row = store.get(id);
    if (!row) return { ok: false, reason: 'not_found' };
    const at = now();
    manualWakeIds.add(id);
    store.schedule(id, {
      state: 'waiting_provider',
      attempts: row.state === 'needs_review' || row.state === 'failed' ? 0 : (Number(row.attempts) || 0),
      providerWaits: Number(row.provider_waits) || 0,
      nextWakeAt: at,
      error: 'manual resume',
      at,
    });
    broadcastSummary({ resumeRequested: id });
    if (hasLease) await reconcile();
    return { ok: true, sessionID: id };
  };

  const dismiss = (sessionID) => {
    const id = asText(sessionID).trim();
    if (!id) return { ok: false, reason: 'invalid_session' };
    const row = store.get(id);
    if (!row) return { ok: false, reason: 'not_found' };
    manualWakeIds.delete(id);
    store.finish(id, 'completed', { error: 'dismissed', at: now() });
    broadcastSummary({ dismissed: id });
    return { ok: true, sessionID: id };
  };

  const wakeWaitingProvider = () => {
    const at = now();
    for (const row of store.pending()) {
      if (row.state === 'waiting_provider') manualWakeIds.add(row.session_id);
    }
    const updated = store.wakeWaitingProvider(at);
    if (updated > 0) {
      broadcastSummary({ woken: updated });
      if (hasLease) scheduleReconcile(0);
    }
    return { ok: true, updated };
  };

  return {
    start,
    stop,
    handleEvent,
    reconcile,
    resumeNow,
    dismiss,
    wakeWaitingProvider,
    status,
    get hasLease() {
      return hasLease;
    },
  };
};
