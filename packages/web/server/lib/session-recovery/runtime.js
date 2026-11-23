import crypto from 'node:crypto';

import {
  DEFAULT_AUTO_CONTINUE_PROVIDERS,
  extractProviderIdFromError,
  isLimitError,
  isLimitErrorType,
  isUsageAutoContinueAllowed,
} from '../limit-failover/policy.js';
import { sessionParentId } from '../session-lineage.js';
import {
  MANUAL_LIMIT_REASON,
  buildResumePrompt,
  decideRecovery,
  isExternalTool,
  providerLimitResetAt,
} from './reconciler.js';
import { createZenSessionDiscoverer, normalizeDirectory } from './discovery.js';

const LEASE_TTL_MS = 60_000;
const LEASE_RENEW_MS = 20_000;
const CONNECT_DEBOUNCE_MS = 2_000;
const RETRY_BASE_MS = 30_000;
const CHILD_DEFER_MS = 15_000;
const CHILD_MAX_DEFER_MS = 5 * 60_000;
const REVIVE_LIMIT_MS = 35 * 24 * 60 * 60_000;
const REVIVE_STAGGER_MS = 30_000;
const MESSAGE_FETCH_LIMIT = 60;
const LIMIT_TRAILING_START_GUARD_MS = 15_000;
const LIMIT_TRAILING_SUCCESS_GUARD_MS = 30_000;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asText = (value) => (typeof value === 'string' ? value : '');

const parentIdFromEventData = (data) => (
  asText(data?.parentID)
  || asText(data?.parentSessionID)
  || asText(data?.info?.parentID)
  || null
);

const providerIdFromEventData = (data, error) => (
  asText(data?.providerID)
  || asText(data?.providerId)
  || asText(data?.model?.providerID)
  || asText(data?.model?.providerId)
  || extractProviderIdFromError(error)
  || ''
);

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
  autoContinueProviders = DEFAULT_AUTO_CONTINUE_PROVIDERS,
  enableDiscovery = true,
}) => {
  const runtimeStartedAt = now();
  let stopped = false;
  let hasLease = false;
  let reconcileTimer = null;
  let wakeTimer = null;
  let heartbeatTimer = null;
  let pollTimer = null;
  let reconcilePromise = null;
  const manualWakeIds = new Set();
  const recentLimitParks = new Map();
  const unsubscribers = [];

  const backoffFor = (attempts) => RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1));

  const clearWakeTimer = () => {
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
  };

  /**
   * Arm a one-shot timer for the earliest upcoming auto-continue wake so Zen
   * continuations fire right on schedule (e.g. 3s) rather than waiting up to
   * pollMs (30s) for the next periodic scan.
   */
  const armNextWakeTimer = () => {
    clearWakeTimer();
    if (stopped || !hasLease) return;
    const at = now();
    let earliest = null;
    for (const row of store.pending()) {
      if (row.state === 'waiting_provider' && row.last_error === MANUAL_LIMIT_REASON && row.next_wake_at === null) {
        continue;
      }
      const wakeAt = Number(row.next_wake_at);
      if (!Number.isFinite(wakeAt) || wakeAt <= 0) continue;
      if (earliest === null || wakeAt < earliest) earliest = wakeAt;
    }
    if (earliest === null) return;
    const delayMs = Math.max(50, Math.min(pollMs, earliest - at + 25));
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      scheduleReconcile(0);
    }, delayMs);
    wakeTimer.unref?.();
  };

  const broadcastSummary = (detail) => {
    broadcastEvent({ type: 'spleen:recovery', properties: { ...status(), ...detail } });
  };

  const status = () => {
    const rows = store.all();
    const counts = {};
    for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
    return {
      coordinator: hasLease,
      autoContinueProviders: [...autoContinueProviders],
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
        autoContinue: row.last_error !== MANUAL_LIMIT_REASON,
      })),
    };
  };

  const parkLimitEvent = ({ sessionID, parentSessionID, directory, seq, error, providerID, at }) => {
    const row = store.get(sessionID);
    const attempts = Number(row?.attempts) || 0;
    const priorWaits = row && row.state !== 'completed' ? (Number(row.provider_waits) || 0) : 0;
    const limitResetAt = providerLimitResetAt(error, at, priorWaits, at, providerID);
    if (limitResetAt === null) return false;
    const allowed = isUsageAutoContinueAllowed({
      providerID,
      error,
      allowedProviders: autoContinueProviders,
    });
    if (!row) {
      store.beginExecution({ sessionID, parentSessionID, directory: directory || null, seq, at });
    } else if (parentSessionID && parentSessionID !== row.parent_session_id) {
      store.noteParent(sessionID, parentSessionID, at);
    }
    store.schedule(sessionID, {
      state: 'waiting_provider',
      attempts,
      providerWaits: priorWaits,
      nextWakeAt: allowed ? limitResetAt : null,
      error: allowed ? 'provider limit' : MANUAL_LIMIT_REASON,
      at,
    });
    store.noteRecovery('limit.parked', sessionID, {
      providerID: providerID || null,
      errorType: asText(error?.type) || null,
      allowed,
      waits: priorWaits,
      nextWakeAt: allowed ? limitResetAt : null,
    }, at);
    broadcastSummary({ parked: sessionID });
    if (allowed) {
      recentLimitParks.set(sessionID, { at, nextWakeAt: limitResetAt, providerID: providerID || '' });
      armNextWakeTimer();
    }
    return true;
  };

  const reviveLimitFailures = () => {
    const at = now();
    let revived = 0;
    for (const row of store.failedSince(at - REVIVE_LIMIT_MS)) {
      if (!isLimitErrorType(row.last_error) && !isLimitError({ type: row.last_error, message: row.last_error })) continue;
      if (!isUsageAutoContinueAllowed({ error: { type: row.last_error, message: row.last_error }, allowedProviders: autoContinueProviders })) {
        continue;
      }
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
    const directory = normalizeDirectory(event?.directory) || normalizeDirectory(data.directory);
    const parentSessionID = parentIdFromEventData(data);
    const seq = Number.isFinite(payload?.durable?.seq) ? payload.durable.seq : null;
    const at = now();

    switch (type) {
      case 'session.execution.started': {
        const recentPark = recentLimitParks.get(sessionID);
        const existing = store.get(sessionID);
        if (recentPark && at - recentPark.at <= LIMIT_TRAILING_START_GUARD_MS && existing?.state === 'waiting_provider') {
          store.noteRecovery('limit.trailing_start_ignored', sessionID, { seq, ageMs: at - recentPark.at }, at);
          armNextWakeTimer();
          break;
        }
        store.beginExecution({ sessionID, parentSessionID, directory, seq, at });
        break;
      }
      case 'session.execution.succeeded': {
        const error = isRecord(data.error) ? data.error : null;
        if (error && parkLimitEvent({
          sessionID,
          parentSessionID,
          directory,
          seq,
          error,
          providerID: providerIdFromEventData(data, error),
          at,
        })) {
          break;
        }
        const recentPark = recentLimitParks.get(sessionID);
        const existing = store.get(sessionID);
        if (
          (recentPark && at - recentPark.at <= LIMIT_TRAILING_SUCCESS_GUARD_MS)
          || (existing?.state === 'waiting_provider' && existing.last_error !== MANUAL_LIMIT_REASON)
        ) {
          const wakeAt = Math.max(
            at + 1_000,
            Number(recentPark?.nextWakeAt) || Number(existing?.next_wake_at) || at + 3_000,
          );
          if (!existing) {
            store.beginExecution({ sessionID, parentSessionID, directory, seq, at });
          }
          store.schedule(sessionID, {
            state: 'waiting_provider',
            attempts: Number(existing?.attempts) || 0,
            providerWaits: Number(existing?.provider_waits) || 0,
            nextWakeAt: wakeAt,
            error: 'provider limit',
            at,
          });
          store.noteRecovery('limit.trailing_success_deferred', sessionID, {
            seq,
            ageMs: recentPark ? at - recentPark.at : null,
            nextWakeAt: wakeAt,
          }, at);
          armNextWakeTimer();
          break;
        }
        recentLimitParks.delete(sessionID);
        store.finish(sessionID, 'completed', { at });
        break;
      }
      case 'session.execution.failed': {
        const error = isRecord(data.error) ? data.error : {};
        if (parkLimitEvent({
          sessionID,
          parentSessionID,
          directory,
          seq,
          error,
          providerID: providerIdFromEventData(data, error),
          at,
        })) {
          break;
        }
        store.finish(sessionID, 'failed', {
          at,
          error: asText(error.type) || asText(error.name) || asText(error.code) || asText(error.message) || 'failed',
        });
        break;
      }
      case 'session.error':
      case 'session.idle': {
        const error = isRecord(data.error) ? data.error : null;
        if (!error) return;
        parkLimitEvent({
          sessionID,
          parentSessionID,
          directory,
          seq,
          error,
          providerID: providerIdFromEventData(data, error),
          at,
        });
        break;
      }
      case 'session.status': {
        const statusInfo = isRecord(data.status) ? data.status : data;
        if (asText(statusInfo?.type) !== 'retry') return;
        const message = asText(statusInfo.message);
        const error = {
          message,
          retryAfterMs: Number.isFinite(statusInfo.next) && statusInfo.next > at ? statusInfo.next - at : undefined,
        };
        parkLimitEvent({
          sessionID,
          parentSessionID,
          directory,
          seq,
          error,
          providerID: providerIdFromEventData(data, error),
          at,
        });
        break;
      }
      case 'session.execution.interrupted': {
        const reason = asText(data.reason) || 'user';
        if (reason === 'user') {
          recentLimitParks.delete(sessionID);
          store.finish(sessionID, 'completed', { at });
        } else {
          store.schedule(sessionID, {
            state: 'recovering',
            attempts: Number(store.get(sessionID)?.attempts) || 0,
            nextWakeAt: at + CHILD_DEFER_MS,
            at,
            error: `interrupted:${reason}`,
          });
        }
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

  const runDiscovery = createZenSessionDiscoverer({
    store,
    openCodeFetch,
    fetchMessages,
    autoContinueProviders,
    now,
  });
  const discoverStoppedZenSessions = async (activeMap, pendingByID) => (
    enableDiscovery ? runDiscovery(activeMap, pendingByID) : []
  );

  const sendResume = async (row, decision) => {
    const sessionID = row.session_id;
    const directory = normalizeDirectory(row.directory);
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
      store.noteRecovery('resume.sent', sessionID, { attempt: decision.attempt, resumeMessageID, afterLimit: Boolean(decision.afterLimit) }, sentAt);
      broadcastSummary({ resumed: sessionID });
      return true;
    } catch (error) {
      const at = now();
      const waits = (Number(row.provider_waits) || 0) + 1;
      const resolvedProviderID = decision.providerID || extractProviderIdFromError(error);
      const limitResetAt = providerLimitResetAt(error, at, waits, at, resolvedProviderID);
      if (limitResetAt !== null) {
        const allowed = isUsageAutoContinueAllowed({
          providerID: resolvedProviderID,
          error,
          allowedProviders: autoContinueProviders,
        });
        store.schedule(sessionID, {
          state: 'waiting_provider',
          attempts: decision.attempt,
          providerWaits: waits,
          nextWakeAt: allowed ? limitResetAt : null,
          error: allowed ? 'provider limit' : MANUAL_LIMIT_REASON,
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

  /**
   * Decide whether a child session must wait for its parent before resuming.
   * Crash recovery always resumes the parent first so parent and child do not
   * duplicate work. For usage-limit stops (`afterLimit` / `waiting_provider`),
   * a stopped subagent must still receive `Continue.` when its parent is
   * actively running (waiting on the subagent's task tool) or already due to
   * wake; it only waits while the parent itself is still parked in the future.
   */
  const shouldDeferToParent = (row, parent, afterLimit) => {
    if (!parent) return false;
    const isUsageLimitChild = afterLimit || row.state === 'waiting_provider';
    if (!isUsageLimitChild) return true;
    const at = now();
    return parent.state === 'waiting_provider' && Number(parent.next_wake_at) > at;
  };

  const reconcileRow = async (row, activeMap, pendingByID) => {
    const sessionID = row.session_id;
    const initialDirectory = normalizeDirectory(row.directory);
    const isManualWake = manualWakeIds.has(sessionID);
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
    if (!isManualWake && storedParent && !activeMap[sessionID] && shouldDeferToParent(row, storedParent, false)) {
      deferToParent(storedParent);
      return;
    }

    const session = await fetchSession(sessionID, initialDirectory);
    const directory = normalizeDirectory(session?.directory) || initialDirectory;
    if (directory && directory !== row.directory) {
      store.noteDirectory(sessionID, directory, now());
    }
    const messages = session ? await fetchMessages(sessionID, directory) : null;
    const parentSessionID = sessionParentId(session) || row.parent_session_id || null;
    if (session && parentSessionID && parentSessionID !== row.parent_session_id) {
      store.noteParent(sessionID, parentSessionID, now());
    }
    const decision = decideRecovery({
      row: { ...row, directory, parent_session_id: parentSessionID },
      active: Boolean(activeMap[sessionID]),
      session,
      messages,
      now: now(),
      maxAttempts,
      autoContinueProviders,
      manualResume: isManualWake,
    });

    switch (decision.action) {
      case 'attach':
        store.schedule(sessionID, { state: 'running', attempts: Number(row.attempts) || 0, at: now() });
        break;
      case 'complete':
        recentLimitParks.delete(sessionID);
        store.finish(sessionID, decision.state, { at: now(), error: decision.reason });
        break;
      case 'needs_review':
        recentLimitParks.delete(sessionID);
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
          nextWakeAt: decision.manualOnly ? null : (decision.nextWakeAt ?? now() + 15_000),
          at: now(),
          error: decision.reason,
        });
        break;
      case 'resume': {
        const manualConsumed = manualWakeIds.delete(sessionID);
        if (!manualConsumed && !decision.afterLimit && now() - runtimeStartedAt < startGraceMs) {
          store.schedule(sessionID, {
            state: 'recovering',
            attempts: Number(row.attempts) || 0,
            nextWakeAt: now() + Math.max(1_000, startGraceMs - (now() - runtimeStartedAt)),
            at: now(),
            error: 'waiting for backend startup',
          });
          break;
        }
        const liveParent = parentSessionID ? pendingByID.get(parentSessionID) : null;
        if (!manualConsumed && liveParent && shouldDeferToParent(row, liveParent, Boolean(decision.afterLimit))) {
          deferToParent(liveParent);
          break;
        }
        recentLimitParks.delete(sessionID);
        await sendResume({ ...row, directory }, decision);
        break;
      }
      default:
        break;
    }
  };

  const runReconcile = async () => {
    if (stopped || !hasLease) return;
    const at = now();
    const pendingRows = store.pending();
    const rows = pendingRows.filter((row) => {
      if (manualWakeIds.has(row.session_id)) return true;
      if (row.state === 'waiting_provider' && row.last_error === MANUAL_LIMIT_REASON && row.next_wake_at === null) {
        return false;
      }
      return !(Number(row.next_wake_at) > at);
    });

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
    const discovered = await discoverStoppedZenSessions(activeMap, pendingByID);
    const queue = [...rows, ...discovered];
    if (queue.length === 0) {
      armNextWakeTimer();
      broadcastSummary({ reconciled: true });
      return;
    }

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
    armNextWakeTimer();
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
    clearWakeTimer();
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
    recentLimitParks.delete(id);
    store.finish(id, 'completed', { error: 'dismissed', at: now() });
    broadcastSummary({ dismissed: id });
    return { ok: true, sessionID: id };
  };

  const wakeWaitingProvider = () => {
    const at = now();
    let updated = 0;
    for (const row of store.pending()) {
      if (row.state !== 'waiting_provider') continue;
      if (row.last_error === MANUAL_LIMIT_REASON) continue;
      manualWakeIds.add(row.session_id);
      store.schedule(row.session_id, {
        state: 'waiting_provider',
        attempts: Number(row.attempts) || 0,
        providerWaits: Number(row.provider_waits) || 0,
        nextWakeAt: at,
        error: row.last_error || 'provider limit',
        at,
      });
      updated += 1;
    }
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
