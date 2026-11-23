import { asNonEmptyString, isRecord } from '../shared/guards.js';
import {
  extractProviderIdFromError,
  isUsageAutoContinueAllowed,
} from '../limit-failover/policy.js';
import { sessionParentId } from '../session-lineage.js';
import { providerLimitResetAt, summarizeTail } from './reconciler.js';

const DISCOVERY_SESSION_LIMIT = 40;
const DISCOVERY_INSPECT_BUDGET = 15;
const DISCOVERY_WINDOW_MS = 24 * 60 * 60_000;

export const normalizeDirectory = (value) => {
  const trimmed = asNonEmptyString(value);
  return trimmed && trimmed !== 'global' ? trimmed : null;
};

export const createZenSessionDiscoverer = ({
  store,
  openCodeFetch,
  fetchMessages,
  autoContinueProviders,
  now,
}) => {
  const checkedUpdatedAt = new Map();

  return async (activeMap, pendingByID) => {
    let list;
    try {
      const raw = await openCodeFetch('/api/session', {
        query: { limit: String(DISCOVERY_SESSION_LIMIT) },
      });
      list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : null);
    } catch {
      return [];
    }
    if (!Array.isArray(list) || list.length === 0) return [];

    const at = now();
    const discovered = [];
    let inspected = 0;

    for (const info of list) {
      if (!isRecord(info)) continue;
      const sessionID = asNonEmptyString(info.id) ?? '';
      if (!sessionID || activeMap[sessionID] || pendingByID.has(sessionID)) continue;
      const updatedAt = Number(info?.time?.updated) || Number(info?.time?.created) || 0;
      if (updatedAt > 0 && at - updatedAt > DISCOVERY_WINDOW_MS) continue;

      const existing = store.get(sessionID);
      if (existing) {
        if (existing.last_error === 'dismissed' && updatedAt <= Number(existing.updated_at || 0)) continue;
        if (
          existing.state === 'completed'
          && existing.last_error === 'no unfinished turn'
          && updatedAt <= Number(existing.updated_at || 0)
        ) {
          continue;
        }
      }

      if (checkedUpdatedAt.get(sessionID) === updatedAt) continue;
      if (inspected >= DISCOVERY_INSPECT_BUDGET) break;
      inspected += 1;

      const parentID = sessionParentId(info) || null;
      const directory = normalizeDirectory(info.directory);
      const messages = await fetchMessages(sessionID, directory);
      if (!Array.isArray(messages)) continue;
      checkedUpdatedAt.set(sessionID, updatedAt);

      const tail = summarizeTail(messages);
      if (!tail?.lastUser || !tail.error) continue;

      const providerID = tail.providerID
        || extractProviderIdFromError(tail.error)
        || asNonEmptyString(info?.model?.providerID)
        || asNonEmptyString(info?.providerID)
        || '';
      if (!isUsageAutoContinueAllowed({ providerID, error: tail.error, allowedProviders: autoContinueProviders })) {
        continue;
      }
      const failedAt = tail.errorAt ?? (updatedAt || at);
      const resetAt = providerLimitResetAt(tail.error, at, 0, failedAt, providerID);
      if (resetAt === null) continue;

      store.beginExecution({ sessionID, parentSessionID: parentID, directory, seq: null, at: failedAt });
      store.schedule(sessionID, {
        state: 'waiting_provider',
        attempts: 0,
        providerWaits: 0,
        nextWakeAt: resetAt,
        error: 'provider limit',
        at,
      });
      const enrolled = store.get(sessionID);
      if (enrolled) {
        pendingByID.set(sessionID, enrolled);
        if (!(Number(enrolled.next_wake_at) > at)) {
          discovered.push(enrolled);
        }
      }
    }

    if (checkedUpdatedAt.size > 500) {
      checkedUpdatedAt.clear();
    }
    return discovered;
  };
};
