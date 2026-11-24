import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { asNonEmptyString } from '../shared/guards.js';
import { loadSqliteOpener } from '../message-search/sqlite.js';
import { looksLikeInjection } from './threat-patterns.js';

export const MEMORY_TIERS = Object.freeze(['working', 'episodic', 'semantic', 'procedural', 'artifact']);
export const MEMORY_SCOPES = Object.freeze(['global', 'project', 'team', 'agent']);
export const VERIFICATION_STATUSES = Object.freeze(['unverified', 'verified', 'contradicted', 'stale']);
export const ORIGIN_CLASSES = Object.freeze(['owner', 'agent', 'untrusted', 'system']);
export const SESSION_KINDS = Object.freeze(['interactive', 'autonomy', 'scheduled', 'subagent', 'team']);

const DAY_MS = 24 * 60 * 60_000;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'semantic',
  scope TEXT NOT NULL DEFAULT 'project',
  scope_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  importance REAL NOT NULL DEFAULT 0.5,
  origin_class TEXT NOT NULL DEFAULT 'agent',
  session_kind TEXT NOT NULL DEFAULT 'interactive',
  supersession_key TEXT,
  trigger_phrases_json TEXT NOT NULL DEFAULT '[]',
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  flagged INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope_tier ON memories(scope, scope_id, tier, updated_at DESC);
CREATE TABLE IF NOT EXISTS memory_versions (
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  confidence REAL NOT NULL,
  verification_status TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, version)
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tags
);
`;

const MIGRATIONS = [
  ['memories', 'importance', 'REAL NOT NULL DEFAULT 0.5'],
  ['memories', 'origin_class', "TEXT NOT NULL DEFAULT 'agent'"],
  ['memories', 'session_kind', "TEXT NOT NULL DEFAULT 'interactive'"],
  ['memories', 'supersession_key', 'TEXT'],
  ['memories', 'trigger_phrases_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['memories', 'recall_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['memories', 'last_recalled_at', 'INTEGER'],
];

const ensureColumns = (db) => {
  const existing = new Set(db.all('PRAGMA table_info(memories)').map((row) => row.name));
  for (const [, col, ddl] of MIGRATIONS) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE memories ADD COLUMN ${col} ${ddl}`);
      existing.add(col);
    }
  }
};

const stripRecalledBlocks = (value) => (
  String(value ?? '')
    .replace(/<spleen-recalled-context>[\s\S]*?<\/spleen-recalled-context>/gi, '')
    .trim()
);

const parseJson = (raw, fallback) => {
  const s = asNonEmptyString(raw);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

const hydrateMemory = (row) => (!row ? null : ({
  id: row.id,
  tier: row.tier,
  scope: row.scope,
  scopeId: row.scope_id,
  title: row.title,
  body: row.body,
  tags: parseJson(row.tags_json, []),
  sources: parseJson(row.sources_json, []),
  confidence: Number(row.confidence ?? 0.5),
  importance: Number(row.importance ?? 0.5),
  originClass: row.origin_class ?? 'agent',
  sessionKind: row.session_kind ?? 'interactive',
  supersessionKey: row.supersession_key ?? null,
  triggerPhrases: parseJson(row.trigger_phrases_json, []),
  recallCount: Number(row.recall_count ?? 0),
  lastRecalledAt: row.last_recalled_at ? Number(row.last_recalled_at) : null,
  verificationStatus: row.verification_status,
  flagged: Boolean(row.flagged),
  version: Number(row.version ?? 1),
  supersededBy: row.superseded_by ?? null,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
}));

const sanitizeFtsQuery = (query) => {
  const tokens = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' OR ');
};

const computeHybridScore = (mem, rawBm25, queryLower, at) => {
  const relevance = 1 / (1 + Math.abs(Number(rawBm25) || 0));
  const halfLifeDays = mem.tier === 'semantic' || mem.tier === 'procedural' ? 180 : 45;
  const ageDays = Math.max(0, (at - mem.updatedAt) / DAY_MS);
  const recency = Math.exp(-ageDays / halfLifeDays);
  const confWeight = 0.5 + 0.5 * Math.max(0, Math.min(1, mem.confidence));
  const impWeight = 0.5 + 0.5 * Math.max(0, Math.min(1, mem.importance));
  const originWeights = { owner: 1.15, agent: 1.0, system: 0.85, untrusted: 0.4 };
  const trustWeight = originWeights[mem.originClass] ?? 1.0;
  const verifiedBoost = mem.verificationStatus === 'verified' ? 1.15 : 1.0;
  const triggerHit = queryLower && mem.triggerPhrases.some((p) => queryLower.includes(String(p).toLowerCase()));
  const triggerBoost = triggerHit ? 0.35 : 0;
  return Number(((relevance + triggerBoost) * (0.65 + 0.35 * recency) * confWeight * impWeight * trustWeight * verifiedBoost).toFixed(4));
};

export const createMemFsStore = ({ dbPath = ':memory:', now = () => Date.now() } = {}) => {
  const openSqlite = loadSqliteOpener();
  if (!openSqlite) throw new Error('SQLite runtime unavailable for MemFS store');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = openSqlite(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA_SQL);
  ensureColumns(db);

  const syncFts = (id, title, body, tags, triggerPhrases = []) => {
    db.run('DELETE FROM memories_fts WHERE id = ?', [id]);
    db.run(
      'INSERT INTO memories_fts (id, title, body, tags) VALUES (?, ?, ?, ?)',
      [id, title, body, [...tags, ...triggerPhrases].join(' ')],
    );
  };

  const getMemory = (id) => hydrateMemory(db.get('SELECT * FROM memories WHERE id = ?', [id]));

  const saveMemory = (input = {}) => {
    const at = now();
    const originClass = ORIGIN_CLASSES.includes(input.originClass) ? input.originClass : 'agent';
    const sessionKind = SESSION_KINDS.includes(input.sessionKind) ? input.sessionKind : 'interactive';
    const requestedTier = MEMORY_TIERS.includes(input.tier) ? input.tier : 'semantic';
    const tier = originClass === 'untrusted' && (requestedTier === 'semantic' || requestedTier === 'procedural')
      ? 'working'
      : requestedTier;
    const scope = MEMORY_SCOPES.includes(input.scope) ? input.scope : 'project';
    const scopeId = asNonEmptyString(input.scopeId) ?? '';
    const title = (asNonEmptyString(stripRecalledBlocks(input.title)) || 'Untitled Memory').slice(0, 160);
    const body = stripRecalledBlocks(input.body);
    if (!body) throw new Error('Memory body is required (empty or recalled-only content rejected)');
    const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((t) => String(t).trim()).filter(Boolean))] : [];
    const triggerPhrases = Array.isArray(input.triggerPhrases)
      ? [...new Set(input.triggerPhrases.map((p) => String(p).trim()).filter(Boolean))].slice(0, 12)
      : [];
    const sources = Array.isArray(input.sources) ? input.sources : [];
    const flagged = looksLikeInjection(title, body) ? 1 : 0;
    const rawConfidence = Math.max(0, Math.min(1, Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.5));
    const confidence = flagged || originClass === 'untrusted' ? Math.min(rawConfidence, 0.4) : rawConfidence;
    const importance = Math.max(0, Math.min(1, Number.isFinite(Number(input.importance)) ? Number(input.importance) : 0.5));
    const rawStatus = VERIFICATION_STATUSES.includes(input.verificationStatus) ? input.verificationStatus : 'unverified';
    const verificationStatus = flagged || originClass === 'untrusted' ? 'unverified' : rawStatus;
    const supersessionKey = asNonEmptyString(input.supersessionKey);
    const reason = asNonEmptyString(input.reason) || 'save';

    const existing = asNonEmptyString(input.id) ? getMemory(input.id) : null;
    if (existing) {
      const nextVersion = existing.version + 1;
      db.transaction(() => {
        db.run(
          `UPDATE memories SET
            tier = ?, scope = ?, scope_id = ?, title = ?, body = ?,
            tags_json = ?, sources_json = ?, confidence = ?, importance = ?,
            origin_class = ?, session_kind = ?, supersession_key = ?, trigger_phrases_json = ?,
            verification_status = ?, flagged = ?, version = ?, superseded_by = ?, updated_at = ?
          WHERE id = ?`,
          [
            tier, scope, scopeId, title, body,
            JSON.stringify(tags), JSON.stringify(sources), confidence, importance,
            originClass, sessionKind, supersessionKey ?? existing.supersessionKey, JSON.stringify(triggerPhrases.length > 0 ? triggerPhrases : existing.triggerPhrases),
            verificationStatus, flagged, nextVersion, input.supersededBy ?? existing.supersededBy, at, existing.id,
          ],
        );
        db.run(
          `INSERT INTO memory_versions (memory_id, version, title, body, confidence, verification_status, sources_json, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [existing.id, nextVersion, title, body, confidence, verificationStatus, JSON.stringify(sources), reason, at],
        );
        syncFts(existing.id, title, body, tags, triggerPhrases.length > 0 ? triggerPhrases : existing.triggerPhrases);
      });
      return getMemory(existing.id);
    }

    const id = asNonEmptyString(input.id) || `mem_${crypto.randomBytes(6).toString('hex')}`;
    db.transaction(() => {
      if (supersessionKey) {
        db.run(
          `UPDATE memories SET superseded_by = ?, updated_at = ?
           WHERE scope = ? AND scope_id = ? AND supersession_key = ? AND superseded_by IS NULL AND id != ?`,
          [id, at, scope, scopeId, supersessionKey, id],
        );
      }
      db.run(
        `INSERT INTO memories (
          id, tier, scope, scope_id, title, body, tags_json, sources_json,
          confidence, importance, origin_class, session_kind, supersession_key,
          trigger_phrases_json, recall_count, last_recalled_at,
          verification_status, flagged, version, superseded_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 1, NULL, ?, ?)`,
        [
          id, tier, scope, scopeId, title, body, JSON.stringify(tags), JSON.stringify(sources),
          confidence, importance, originClass, sessionKind, supersessionKey,
          JSON.stringify(triggerPhrases),
          verificationStatus, flagged, at, at,
        ],
      );
      db.run(
        `INSERT INTO memory_versions (memory_id, version, title, body, confidence, verification_status, sources_json, reason, created_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, body, confidence, verificationStatus, JSON.stringify(sources), reason, at],
      );
      syncFts(id, title, body, tags, triggerPhrases);
    });
    return getMemory(id);
  };

  const listHistory = (memoryId) => (
    db.all('SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version DESC', [memoryId]).map((row) => ({
      memoryId: row.memory_id,
      version: Number(row.version),
      title: row.title,
      body: row.body,
      confidence: Number(row.confidence),
      verificationStatus: row.verification_status,
      sources: parseJson(row.sources_json, []),
      reason: row.reason ?? null,
      createdAt: Number(row.created_at),
    }))
  );

  const rollbackMemory = (memoryId, targetVersion) => {
    const current = getMemory(memoryId);
    if (!current) throw new Error(`Memory not found: ${memoryId}`);
    const snap = db.get('SELECT * FROM memory_versions WHERE memory_id = ? AND version = ?', [memoryId, Number(targetVersion)]);
    if (!snap) throw new Error(`Version ${targetVersion} not found for ${memoryId}`);
    return saveMemory({
      id: memoryId,
      tier: current.tier,
      scope: current.scope,
      scopeId: current.scopeId,
      title: snap.title,
      body: snap.body,
      tags: current.tags,
      triggerPhrases: current.triggerPhrases,
      originClass: current.originClass,
      sessionKind: current.sessionKind,
      supersessionKey: current.supersessionKey,
      importance: current.importance,
      sources: parseJson(snap.sources_json, []),
      confidence: Number(snap.confidence),
      verificationStatus: snap.verification_status,
      reason: `rollback to v${targetVersion}`,
    });
  };

  const deleteMemory = (id) => {
    const existing = getMemory(id);
    if (!existing) return false;
    db.transaction(() => {
      db.run('DELETE FROM memories WHERE id = ?', [id]);
      db.run('DELETE FROM memories_fts WHERE id = ?', [id]);
      db.run('DELETE FROM memory_versions WHERE memory_id = ?', [id]);
    });
    return true;
  };

  const listMemories = ({
    tier = null,
    scope = null,
    scopeId = null,
    originClass = null,
    verificationStatus = null,
    minConfidence = 0,
    includeFlagged = false,
    includeSuperseded = false,
    limit = 100,
  } = {}) => {
    const clauses = [];
    const params = [];
    if (asNonEmptyString(tier)) { clauses.push('tier = ?'); params.push(tier); }
    if (asNonEmptyString(scope)) { clauses.push('scope = ?'); params.push(scope); }
    if (scopeId !== null && scopeId !== undefined) { clauses.push('scope_id = ?'); params.push(String(scopeId)); }
    if (asNonEmptyString(originClass)) { clauses.push('origin_class = ?'); params.push(originClass); }
    if (asNonEmptyString(verificationStatus)) { clauses.push('verification_status = ?'); params.push(verificationStatus); }
    if (Number(minConfidence) > 0) { clauses.push('confidence >= ?'); params.push(Number(minConfidence)); }
    if (!includeFlagged) clauses.push('flagged = 0');
    if (!includeSuperseded) clauses.push('superseded_by IS NULL');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    params.push(capped);
    return db.all(`SELECT * FROM memories ${where} ORDER BY confidence DESC, importance DESC, updated_at DESC LIMIT ?`, params).map(hydrateMemory);
  };

  const searchMemories = ({
    query = '',
    tier = null,
    scope = null,
    scopeId = null,
    originClass = null,
    minConfidence = 0,
    includeStale = false,
    includeFlagged = false,
    recordRecall = true,
    limit = 20,
  } = {}) => {
    const at = now();
    const cleanQuery = stripRecalledBlocks(query);
    const ftsQuery = sanitizeFtsQuery(cleanQuery);
    if (!ftsQuery) {
      return listMemories({ tier, scope, scopeId, originClass, minConfidence, includeFlagged, limit })
        .filter((m) => includeStale || m.verificationStatus !== 'stale');
    }
    const clauses = ['memories_fts MATCH ?'];
    const params = [ftsQuery];
    if (asNonEmptyString(tier)) { clauses.push('m.tier = ?'); params.push(tier); }
    if (asNonEmptyString(scope)) { clauses.push('m.scope = ?'); params.push(scope); }
    if (scopeId !== null && scopeId !== undefined) { clauses.push('m.scope_id = ?'); params.push(String(scopeId)); }
    if (asNonEmptyString(originClass)) { clauses.push('m.origin_class = ?'); params.push(originClass); }
    if (Number(minConfidence) > 0) { clauses.push('m.confidence >= ?'); params.push(Number(minConfidence)); }
    if (!includeStale) clauses.push("m.verification_status != 'stale'");
    if (!includeFlagged) clauses.push('m.flagged = 0');
    clauses.push('m.superseded_by IS NULL');
    const capped = Math.max(1, Math.min(200, Number(limit) || 20));
    params.push(Math.min(200, capped * 3));

    const queryLower = cleanQuery.toLowerCase();
    const scored = db.all(
      `SELECT m.*, bm25(memories_fts) AS rank
       FROM memories_fts
       JOIN memories m ON m.id = memories_fts.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY rank ASC, m.confidence DESC, m.updated_at DESC
       LIMIT ?`,
      params,
    )
      .map((row) => {
        const mem = hydrateMemory(row);
        return { ...mem, score: computeHybridScore(mem, row.rank, queryLower, at) };
      })
      .sort((a, b) => (b.score - a.score) || (b.updatedAt - a.updatedAt))
      .slice(0, capped);

    if (recordRecall && scored.length > 0) {
      db.transaction(() => {
        for (const hit of scored) {
          db.run('UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?', [at, hit.id]);
          hit.recallCount += 1;
          hit.lastRecalledAt = at;
        }
      });
    }
    return scored;
  };

  const migrateLegacyJson = (entries = [], { scope = 'project', scopeId = '' } = {}) => {
    let migrated = 0;
    const typeToTier = { fact: 'semantic', preference: 'procedural', reference: 'artifact' };
    for (const entry of Array.isArray(entries) ? entries : []) {
      const legacyId = asNonEmptyString(entry?.id);
      if (legacyId && getMemory(legacyId)) continue;
      if (!asNonEmptyString(entry?.body)) continue;
      saveMemory({
        id: legacyId || undefined,
        tier: typeToTier[entry.type] || 'semantic',
        scope,
        scopeId,
        title: entry.title || 'Migrated Memory',
        body: entry.body,
        confidence: 0.7,
        originClass: 'owner',
        sessionKind: 'interactive',
        verificationStatus: 'unverified',
        sources: entry.sessionId ? [{ kind: 'session', ref: entry.sessionId }] : [],
        reason: 'migrated from memory.json',
      });
      migrated += 1;
    }
    return { migrated };
  };

  return {
    saveMemory,
    getMemory,
    deleteMemory,
    listMemories,
    searchMemories,
    listHistory,
    rollbackMemory,
    migrateLegacyJson,
    close: () => db.close(),
  };
};
