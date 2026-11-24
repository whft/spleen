import fs from 'node:fs';
import path from 'node:path';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { loadSqliteOpener } from '../message-search/sqlite.js';
import {
  DEFAULT_AUTO_CONTINUE_PROVIDERS,
  extractProviderIdFromError,
  isLimitError,
  isOpenCodeZenProvider,
  normalizeProviderId,
  parseModelSetting,
} from '../limit-failover/policy.js';
import { providerLimitResetAt } from '../session-recovery/reconciler.js';

const CATALOG_CACHE_TTL_MS = 30_000;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provider_cooldowns (
  scope_key TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  credential_id TEXT NOT NULL DEFAULT '',
  error_type TEXT,
  reason TEXT,
  reset_at INTEGER NOT NULL,
  waits INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session_model_failovers (
  session_id TEXT PRIMARY KEY,
  original_provider_id TEXT NOT NULL,
  original_model_id TEXT NOT NULL,
  active_provider_id TEXT NOT NULL,
  active_model_id TEXT NOT NULL,
  restore_after INTEGER NOT NULL,
  switched_at INTEGER NOT NULL
);
`;

const makeScopeKey = (providerID, modelID = '', credentialID = '') => {
  const p = normalizeProviderId(providerID) || 'unknown';
  const m = (asNonEmptyString(modelID) || '*').toLowerCase();
  const c = (asNonEmptyString(credentialID) || '*').toLowerCase();
  return `${p}::${m}::${c}`;
};

const isZeroNumber = (value) => {
  if (value === undefined || value === null) return true;
  const num = Number(value);
  return Number.isFinite(num) && num === 0;
};

const FREE_ZEN_POOL_PROVIDERS = Object.freeze(['opencode', 'opencode-zen']);

export const isVerifiedZeroCostZenModel = (model, allowedProviders = FREE_ZEN_POOL_PROVIDERS) => {
  if (!isRecord(model)) return false;
  const providerID = asNonEmptyString(model.providerID);
  const id = asNonEmptyString(model.id) || asNonEmptyString(model.modelID);
  if (!providerID || !id) return false;
  if (!isOpenCodeZenProvider(providerID, allowedProviders)) return false;
  if (model.enabled === false || model.status === 'deprecated') return false;

  const cost = model.cost;
  if (Array.isArray(cost)) {
    if (cost.length === 0) return false;
    return cost.every((tier) => (
      isRecord(tier)
      && Number.isFinite(Number(tier.input))
      && Number(tier.input) === 0
      && Number.isFinite(Number(tier.output))
      && Number(tier.output) === 0
      && isZeroNumber(tier.cacheRead)
      && isZeroNumber(tier.cacheWrite)
    ));
  }
  if (isRecord(cost)) {
    return (
      Number.isFinite(Number(cost.input))
      && Number(cost.input) === 0
      && Number.isFinite(Number(cost.output))
      && Number(cost.output) === 0
      && isZeroNumber(cost.cacheRead)
      && isZeroNumber(cost.cacheWrite)
    );
  }
  return false;
};

export const createProviderGate = ({
  dbPath = ':memory:',
  readModelCatalog = null,
  readSettings = null,
  broadcastEvent = null,
  allowedProviders = DEFAULT_AUTO_CONTINUE_PROVIDERS,
  now = () => Date.now(),
} = {}) => {
  const openSqlite = loadSqliteOpener();
  if (!openSqlite) throw new Error('SQLite runtime unavailable for ProviderGate');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = openSqlite(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA_SQL);

  let catalogCache = { at: 0, directory: '', models: [] };

  const emit = (type, properties) => {
    if (!broadcastEvent) return;
    try {
      broadcastEvent({ type, properties: { ...properties, timestamp: now() } });
    } catch {}
  };

  const pruneExpired = (at = now()) => {
    db.run('DELETE FROM provider_cooldowns WHERE reset_at <= ?', [at]);
  };

  const recordLimit = ({
    providerID = '',
    modelID = '',
    credentialID = '',
    error = null,
    resetAt = null,
    at = now(),
  } = {}) => {
    const resolvedProvider = normalizeProviderId(providerID) || extractProviderIdFromError(error) || 'opencode';
    const resolvedModel = asNonEmptyString(modelID) || '';
    const resolvedCredential = asNonEmptyString(credentialID) || '';
    const scopeKey = makeScopeKey(resolvedProvider, resolvedModel, resolvedCredential);
    const existing = db.get('SELECT * FROM provider_cooldowns WHERE scope_key = ?', [scopeKey]);
    const priorWaits = existing && Number(existing.reset_at) > at ? Number(existing.waits) + 1 : 0;
    const computedReset = Number.isFinite(Number(resetAt)) && Number(resetAt) > at
      ? Number(resetAt)
      : providerLimitResetAt(isRecord(error) ? error : { type: 'provider.rate-limit', message: String(error ?? 'rate limit') }, at, priorWaits, at, resolvedProvider);
    if (!computedReset) return null;

    const effectiveReset = existing && Number(existing.reset_at) > computedReset
      ? Number(existing.reset_at)
      : computedReset;
    const errorType = asNonEmptyString(error?.type) || asNonEmptyString(error?.code) || 'provider.limit';
    const reason = asNonEmptyString(error?.message) || errorType;

    db.run(
      `INSERT INTO provider_cooldowns (scope_key, provider_id, model_id, credential_id, error_type, reason, reset_at, waits, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         error_type = excluded.error_type,
         reason = excluded.reason,
         reset_at = excluded.reset_at,
         waits = excluded.waits,
         updated_at = excluded.updated_at`,
      [scopeKey, resolvedProvider, resolvedModel, resolvedCredential, errorType, reason.slice(0, 400), effectiveReset, priorWaits, at],
    );

    const record = {
      scopeKey,
      providerID: resolvedProvider,
      modelID: resolvedModel || null,
      credentialID: resolvedCredential || null,
      errorType,
      reason: reason.slice(0, 400),
      resetAt: effectiveReset,
      waits: priorWaits,
      updatedAt: at,
    };
    emit('spleen:provider-cooldown', record);
    return record;
  };

  const getCooldown = ({ providerID = '', modelID = '', credentialID = '', at = now() } = {}) => {
    pruneExpired(at);
    const resolvedProvider = normalizeProviderId(providerID);
    if (!resolvedProvider) return { blocked: false, resetAt: null, remainingMs: 0, reason: null };

    const keys = [
      makeScopeKey(resolvedProvider, modelID, credentialID),
      makeScopeKey(resolvedProvider, modelID, ''),
      makeScopeKey(resolvedProvider, '', credentialID),
      makeScopeKey(resolvedProvider, '', ''),
    ];
    let latest = null;
    for (const key of new Set(keys)) {
      const row = db.get('SELECT * FROM provider_cooldowns WHERE scope_key = ? AND reset_at > ?', [key, at]);
      if (row && (!latest || Number(row.reset_at) > Number(latest.reset_at))) {
        latest = row;
      }
    }
    if (!latest) return { blocked: false, resetAt: null, remainingMs: 0, reason: null };
    const resetAt = Number(latest.reset_at);
    return {
      blocked: true,
      resetAt,
      remainingMs: Math.max(0, resetAt - at),
      reason: latest.reason ?? null,
      errorType: latest.error_type ?? null,
      waits: Number(latest.waits ?? 0),
    };
  };

  const clearCooldown = ({ providerID = '', modelID = '', credentialID = '' } = {}) => {
    const resolvedProvider = normalizeProviderId(providerID);
    if (!resolvedProvider) {
      db.run('DELETE FROM provider_cooldowns');
      return;
    }
    if (!asNonEmptyString(modelID) && !asNonEmptyString(credentialID)) {
      db.run('DELETE FROM provider_cooldowns WHERE provider_id = ?', [resolvedProvider]);
      return;
    }
    db.run('DELETE FROM provider_cooldowns WHERE scope_key = ?', [makeScopeKey(resolvedProvider, modelID, credentialID)]);
  };

  const discoverFreeZenModels = async (directory = '', { forceRefresh = false } = {}) => {
    if (!readModelCatalog) return [];
    const at = now();
    const dir = asNonEmptyString(directory) || '';
    if (!forceRefresh && catalogCache.models.length > 0 && catalogCache.directory === dir && at - catalogCache.at < CATALOG_CACHE_TTL_MS) {
      return catalogCache.models;
    }
    const raw = await Promise.resolve(readModelCatalog(dir)).catch(() => []);
    const list = Array.isArray(raw) ? raw : [];
    const verified = list
      .filter((entry) => isVerifiedZeroCostZenModel(entry, FREE_ZEN_POOL_PROVIDERS))
      .map((entry) => ({
        providerID: entry.providerID,
        id: asNonEmptyString(entry.id) || entry.modelID,
        modelID: asNonEmptyString(entry.modelID) || entry.id,
        name: asNonEmptyString(entry.name) || entry.id || entry.modelID,
        contextLimit: Number(entry?.limit?.context) || 0,
      }))
      .sort((a, b) => (b.contextLimit - a.contextLimit) || a.id.localeCompare(b.id));
    catalogCache = { at, directory: dir, models: verified };
    return verified;
  };

  const selectFailoverModel = async ({
    sessionID = '',
    providerID = '',
    modelID = '',
    directory = '',
    error = null,
    at = now(),
  } = {}) => {
    const settings = readSettings ? await Promise.resolve(readSettings()).catch(() => null) : null;
    const explicitFallback = parseModelSetting(settings?.fallbackModel, settings?.fallbackVariant);
    if (explicitFallback && !(explicitFallback.providerID === providerID && explicitFallback.id === modelID)) {
      const fbCooldown = getCooldown({ providerID: explicitFallback.providerID, modelID: explicitFallback.id, at });
      if (!fbCooldown.blocked) {
        return { model: explicitFallback, kind: 'configured-fallback', verifiedZeroCost: false };
      }
    }

    const freeFailoverSetting = settings?.freeZenFailoverEnabled;
    const isZenSource = isOpenCodeZenProvider(providerID, allowedProviders);
    const allowFreePool = freeFailoverSetting === true || (freeFailoverSetting !== false && isZenSource);
    if (!allowFreePool) return null;

    const currentCooldown = error
      ? recordLimit({ providerID, modelID, error, at })
      : getCooldown({ providerID, modelID, at });
    const restoreAfter = Number(currentCooldown?.resetAt) || (at + 60_000);

    const freeModels = await discoverFreeZenModels(directory);
    if (freeModels.length === 0) return null;

    const preferredOrder = Array.isArray(settings?.freeZenModelOrder)
      ? settings.freeZenModelOrder.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      : [];

    const ordered = [...freeModels].sort((a, b) => {
      const aIdx = preferredOrder.indexOf(a.id.toLowerCase());
      const bIdx = preferredOrder.indexOf(b.id.toLowerCase());
      if (aIdx !== -1 || bIdx !== -1) {
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      }
      return 0;
    });

    const currentLower = (asNonEmptyString(modelID) || '').toLowerCase();
    const candidate = ordered.find((entry) => {
      if (normalizeProviderId(entry.providerID) === normalizeProviderId(providerID)
        && (entry.id.toLowerCase() === currentLower || entry.modelID.toLowerCase() === currentLower)) {
        return false;
      }
      return !getCooldown({ providerID: entry.providerID, modelID: entry.id, at }).blocked;
    });
    if (!candidate) return null;

    const cleanSession = asNonEmptyString(sessionID);
    if (cleanSession && asNonEmptyString(providerID) && asNonEmptyString(modelID)) {
      const existingSwitch = db.get('SELECT * FROM session_model_failovers WHERE session_id = ?', [cleanSession]);
      const origProvider = existingSwitch ? existingSwitch.original_provider_id : providerID;
      const origModel = existingSwitch ? existingSwitch.original_model_id : modelID;
      db.run(
        `INSERT INTO session_model_failovers (session_id, original_provider_id, original_model_id, active_provider_id, active_model_id, restore_after, switched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           active_provider_id = excluded.active_provider_id,
           active_model_id = excluded.active_model_id,
           restore_after = excluded.restore_after,
           switched_at = excluded.switched_at`,
        [cleanSession, origProvider, origModel, candidate.providerID, candidate.id, restoreAfter, at],
      );
    }

    return {
      model: { providerID: candidate.providerID, id: candidate.id },
      kind: 'free-zen-pool',
      verifiedZeroCost: true,
      restoreAfter,
    };
  };

  const getRestorableModel = (sessionID, at = now()) => {
    const cleanSession = asNonEmptyString(sessionID);
    if (!cleanSession) return null;
    const row = db.get('SELECT * FROM session_model_failovers WHERE session_id = ?', [cleanSession]);
    if (!row) return null;
    if (at < Number(row.restore_after)) return null;
    const cd = getCooldown({ providerID: row.original_provider_id, modelID: row.original_model_id, at });
    if (cd.blocked) return null;
    db.run('DELETE FROM session_model_failovers WHERE session_id = ?', [cleanSession]);
    return {
      providerID: row.original_provider_id,
      id: row.original_model_id,
    };
  };

  const listCooldowns = (at = now()) => {
    pruneExpired(at);
    return db.all('SELECT * FROM provider_cooldowns ORDER BY reset_at ASC').map((row) => ({
      scopeKey: row.scope_key,
      providerID: row.provider_id,
      modelID: row.model_id || null,
      credentialID: row.credential_id || null,
      errorType: row.error_type || null,
      reason: row.reason || null,
      resetAt: Number(row.reset_at),
      remainingMs: Math.max(0, Number(row.reset_at) - at),
      waits: Number(row.waits ?? 0),
      updatedAt: Number(row.updated_at),
    }));
  };

  const listActiveFailovers = () => (
    db.all('SELECT * FROM session_model_failovers ORDER BY switched_at DESC').map((row) => ({
      sessionID: row.session_id,
      originalProviderID: row.original_provider_id,
      originalModelID: row.original_model_id,
      activeProviderID: row.active_provider_id,
      activeModelID: row.active_model_id,
      restoreAfter: Number(row.restore_after),
      switchedAt: Number(row.switched_at),
    }))
  );

  return {
    isLimitError,
    isVerifiedZeroCostZenModel: (m) => isVerifiedZeroCostZenModel(m, allowedProviders),
    recordLimit,
    getCooldown,
    clearCooldown,
    discoverFreeZenModels,
    selectFailoverModel,
    getRestorableModel,
    listCooldowns,
    listActiveFailovers,
    close: () => db.close(),
  };
};
