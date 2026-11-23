import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { loadSqliteOpener } from '../message-search/sqlite.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  location TEXT NOT NULL,
  branch TEXT,
  commit_sha TEXT,
  build_hash TEXT,
  build_version TEXT,
  offline_only INTEGER NOT NULL DEFAULT 1,
  refresh_interval_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  last_indexed_at INTEGER,
  last_error TEXT,
  doc_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  path_or_url TEXT NOT NULL,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  byte_size INTEGER NOT NULL DEFAULT 0,
  injection_detected INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_docs_source ON research_documents(source_id, path_or_url);
CREATE TABLE IF NOT EXISTS research_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_research_chunks_doc ON research_chunks(document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS research_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  title,
  content,
  path_or_url
);
CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.6,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  build_hash TEXT,
  build_version TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const parseJson = (raw, fallback) => {
  const s = asNonEmptyString(raw);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

const hydrateSource = (row) => (!row ? null : ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  location: row.location,
  branch: row.branch ?? null,
  commitSha: row.commit_sha ?? null,
  buildHash: row.build_hash ?? null,
  buildVersion: row.build_version ?? null,
  offlineOnly: Boolean(row.offline_only),
  refreshIntervalMs: Number(row.refresh_interval_ms ?? 0),
  status: row.status,
  lastIndexedAt: row.last_indexed_at ? Number(row.last_indexed_at) : null,
  lastError: row.last_error ?? null,
  docCount: Number(row.doc_count ?? 0),
  metadata: parseJson(row.metadata_json, {}),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
}));

const hydrateFinding = (row) => (!row ? null : ({
  id: row.id,
  title: row.title,
  summary: row.summary,
  citations: parseJson(row.citations_json, []),
  confidence: Number(row.confidence ?? 0.6),
  verificationStatus: row.verification_status,
  buildHash: row.build_hash ?? null,
  buildVersion: row.build_version ?? null,
  tags: parseJson(row.tags_json, []),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
}));

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
};

const sanitizeFts = (q) => {
  const tokens = String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-.\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
  return tokens.length > 0 ? tokens.map((t) => `"${t}"*`).join(' OR ') : '';
};

export const createResearchStore = ({ dbPath = ':memory:', now = () => Date.now() } = {}) => {
  const openSqlite = loadSqliteOpener();
  if (!openSqlite) throw new Error('SQLite runtime unavailable for Research store');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openSqlite(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA_SQL);

  const registerSource = (input = {}) => {
    const at = now();
    const id = asNonEmptyString(input.id) || `src_${crypto.randomBytes(6).toString('hex')}`;
    const name = asNonEmptyString(input.name) || path.basename(asNonEmptyString(input.location) || 'source');
    const kind = asNonEmptyString(input.kind) || 'directory';
    const location = asNonEmptyString(input.location);
    if (!location) throw new Error('Source location is required');
    db.run(
      `INSERT INTO research_sources (
        id, name, kind, location, branch, commit_sha, build_hash, build_version,
        offline_only, refresh_interval_ms, status, last_indexed_at, last_error,
        doc_count, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, NULL, 0, ?, ?, ?)`,
      [
        id, name, kind, location,
        asNonEmptyString(input.branch), asNonEmptyString(input.commitSha),
        asNonEmptyString(input.buildHash), asNonEmptyString(input.buildVersion),
        input.offlineOnly === false ? 0 : 1,
        Math.max(0, Number(input.refreshIntervalMs) || 0),
        JSON.stringify(isRecord(input.metadata) ? input.metadata : {}),
        at, at,
      ],
    );
    return getSource(id);
  };

  const getSource = (id) => hydrateSource(db.get('SELECT * FROM research_sources WHERE id = ?', [id]));
  const listSources = () => db.all('SELECT * FROM research_sources ORDER BY updated_at DESC').map(hydrateSource);

  const updateSource = (id, patch = {}) => {
    const cur = getSource(id);
    if (!cur) return null;
    const at = now();
    db.run(
      `UPDATE research_sources SET
        name = ?, branch = ?, commit_sha = ?, build_hash = ?, build_version = ?,
        status = ?, last_indexed_at = ?, last_error = ?, doc_count = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?`,
      [
        asNonEmptyString(patch.name) ?? cur.name,
        patch.branch !== undefined ? asNonEmptyString(patch.branch) : cur.branch,
        patch.commitSha !== undefined ? asNonEmptyString(patch.commitSha) : cur.commitSha,
        patch.buildHash !== undefined ? asNonEmptyString(patch.buildHash) : cur.buildHash,
        patch.buildVersion !== undefined ? asNonEmptyString(patch.buildVersion) : cur.buildVersion,
        asNonEmptyString(patch.status) ?? cur.status,
        patch.lastIndexedAt !== undefined ? patch.lastIndexedAt : cur.lastIndexedAt,
        patch.lastError !== undefined ? asNonEmptyString(patch.lastError) : cur.lastError,
        Number.isFinite(Number(patch.docCount)) ? Number(patch.docCount) : cur.docCount,
        JSON.stringify(isRecord(patch.metadata) ? { ...cur.metadata, ...patch.metadata } : cur.metadata),
        at, id,
      ],
    );
    return getSource(id);
  };

  const deleteSource = (id) => {
    const cur = getSource(id);
    if (!cur) return false;
    db.transaction(() => {
      const chunks = db.all('SELECT id FROM research_chunks WHERE source_id = ?', [id]);
      for (const c of chunks) db.run('DELETE FROM research_chunks_fts WHERE chunk_id = ?', [c.id]);
      db.run('DELETE FROM research_chunks WHERE source_id = ?', [id]);
      db.run('DELETE FROM research_documents WHERE source_id = ?', [id]);
      db.run('DELETE FROM research_sources WHERE id = ?', [id]);
    });
    return true;
  };

  const upsertDocument = ({
    sourceId,
    pathOrUrl,
    title,
    contentHash,
    mimeType = 'text/plain',
    byteSize = 0,
    injectionDetected = false,
    metadata = {},
    chunks = [],
  }) => {
    const at = now();
    const existing = db.get('SELECT id, content_hash FROM research_documents WHERE source_id = ? AND path_or_url = ?', [sourceId, pathOrUrl]);
    if (existing && existing.content_hash === contentHash) {
      db.run('UPDATE research_documents SET stale = 0, indexed_at = ? WHERE id = ?', [at, existing.id]);
      return { id: existing.id, skipped: true };
    }
    const docId = existing?.id || `doc_${crypto.randomBytes(6).toString('hex')}`;
    db.transaction(() => {
      if (existing) {
        const oldChunks = db.all('SELECT id FROM research_chunks WHERE document_id = ?', [docId]);
        for (const c of oldChunks) db.run('DELETE FROM research_chunks_fts WHERE chunk_id = ?', [c.id]);
        db.run('DELETE FROM research_chunks WHERE document_id = ?', [docId]);
        db.run(
          `UPDATE research_documents SET title = ?, content_hash = ?, mime_type = ?, byte_size = ?,
            injection_detected = ?, stale = 0, metadata_json = ?, indexed_at = ? WHERE id = ?`,
          [title, contentHash, mimeType, byteSize, injectionDetected ? 1 : 0, JSON.stringify(metadata), at, docId],
        );
      } else {
        db.run(
          `INSERT INTO research_documents (id, source_id, path_or_url, title, content_hash, mime_type, byte_size, injection_detected, stale, metadata_json, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [docId, sourceId, pathOrUrl, title, contentHash, mimeType, byteSize, injectionDetected ? 1 : 0, JSON.stringify(metadata), at],
        );
      }
      chunks.forEach((chunk, index) => {
        const chunkId = `${docId}_c${index}`;
        const text = typeof chunk === 'object' ? String(chunk.content ?? '') : String(chunk ?? '');
        const emb = typeof chunk === 'object' && Array.isArray(chunk.embedding) ? JSON.stringify(chunk.embedding) : null;
        db.run(
          'INSERT INTO research_chunks (id, document_id, source_id, chunk_index, content, embedding_json) VALUES (?, ?, ?, ?, ?, ?)',
          [chunkId, docId, sourceId, index, text, emb],
        );
        db.run(
          'INSERT INTO research_chunks_fts (chunk_id, title, content, path_or_url) VALUES (?, ?, ?, ?)',
          [chunkId, title, text, pathOrUrl],
        );
      });
    });
    return { id: docId, skipped: false };
  };

  const markMissingDocsStale = (sourceId, activePathsSet) => {
    const docs = db.all('SELECT id, path_or_url FROM research_documents WHERE source_id = ? AND stale = 0', [sourceId]);
    let staleCount = 0;
    for (const d of docs) {
      if (!activePathsSet.has(d.path_or_url)) {
        db.run('UPDATE research_documents SET stale = 1 WHERE id = ?', [d.id]);
        staleCount += 1;
      }
    }
    return staleCount;
  };

  const listDocumentsBySource = (sourceId) => (
    db.all('SELECT * FROM research_documents WHERE source_id = ? ORDER BY path_or_url ASC', [sourceId]).map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      pathOrUrl: row.path_or_url,
      title: row.title,
      contentHash: row.content_hash,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      injectionDetected: Boolean(row.injection_detected),
      stale: Boolean(row.stale),
      metadata: parseJson(row.metadata_json, {}),
      indexedAt: Number(row.indexed_at),
    }))
  );

  const search = ({
    query = '',
    queryEmbedding = null,
    sourceId = null,
    buildHash = null,
    includeStale = false,
    includeQuarantined = false,
    limit = 15,
  } = {}) => {
    const fts = sanitizeFts(query);
    if (!fts && !Array.isArray(queryEmbedding)) return [];
    const clauses = [];
    const params = [];
    if (fts) { clauses.push('research_chunks_fts MATCH ?'); params.push(fts); }
    if (asNonEmptyString(sourceId)) { clauses.push('c.source_id = ?'); params.push(sourceId); }
    if (asNonEmptyString(buildHash)) { clauses.push('s.build_hash = ?'); params.push(buildHash); }
    if (!includeStale) clauses.push('d.stale = 0');
    if (!includeQuarantined) clauses.push('d.injection_detected = 0');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const capped = Math.max(1, Math.min(100, Number(limit) || 15));
    params.push(capped * 2);

    const rows = fts
      ? db.all(
          `SELECT c.id AS chunk_id, c.chunk_index, c.content, c.embedding_json,
                  d.id AS doc_id, d.path_or_url, d.title, d.stale, d.injection_detected, d.indexed_at,
                  s.id AS source_id, s.name AS source_name, s.branch, s.commit_sha, s.build_hash, s.build_version,
                  bm25(research_chunks_fts) AS lex_rank
           FROM research_chunks_fts
           JOIN research_chunks c ON c.id = research_chunks_fts.chunk_id
           JOIN research_documents d ON d.id = c.document_id
           JOIN research_sources s ON s.id = c.source_id
           ${where}
           ORDER BY lex_rank ASC
           LIMIT ?`,
          params,
        )
      : db.all(
          `SELECT c.id AS chunk_id, c.chunk_index, c.content, c.embedding_json,
                  d.id AS doc_id, d.path_or_url, d.title, d.stale, d.injection_detected, d.indexed_at,
                  s.id AS source_id, s.name AS source_name, s.branch, s.commit_sha, s.build_hash, s.build_version,
                  0 AS lex_rank
           FROM research_chunks c
           JOIN research_documents d ON d.id = c.document_id
           JOIN research_sources s ON s.id = c.source_id
           ${where}
           LIMIT ?`,
          params,
        );

    return rows.map((row, idx) => {
      const lexScore = 1 / (60 + idx + 1);
      const emb = parseJson(row.embedding_json, null);
      const vecScore = Array.isArray(queryEmbedding) && Array.isArray(emb) ? Math.max(0, cosineSimilarity(queryEmbedding, emb)) : 0;
      return {
        chunkId: row.chunk_id,
        documentId: row.doc_id,
        chunkIndex: Number(row.chunk_index),
        title: row.title,
        excerpt: row.content.slice(0, 600),
        score: Number((lexScore + vecScore).toFixed(5)),
        untrustedEvidence: true,
        injectionDetected: Boolean(row.injection_detected),
        stale: Boolean(row.stale),
        citation: {
          sourceId: row.source_id,
          sourceName: row.source_name,
          pathOrUrl: row.path_or_url,
          branch: row.branch ?? null,
          commitSha: row.commit_sha ?? null,
          buildHash: row.build_hash ?? null,
          buildVersion: row.build_version ?? null,
          indexedAt: Number(row.indexed_at),
        },
      };
    }).sort((a, b) => b.score - a.score).slice(0, capped);
  };

  const recordFinding = (input = {}) => {
    const at = now();
    const id = asNonEmptyString(input.id) || `fnd_${crypto.randomBytes(6).toString('hex')}`;
    const title = asNonEmptyString(input.title) || 'Finding';
    const summary = asNonEmptyString(input.summary) || '';
    if (!summary) throw new Error('Finding summary is required');
    db.run(
      `INSERT INTO research_findings (id, title, summary, citations_json, confidence, verification_status, build_hash, build_version, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, title, summary,
        JSON.stringify(Array.isArray(input.citations) ? input.citations : []),
        Math.max(0, Math.min(1, Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.6)),
        asNonEmptyString(input.verificationStatus) || 'unverified',
        asNonEmptyString(input.buildHash), asNonEmptyString(input.buildVersion),
        JSON.stringify(Array.isArray(input.tags) ? input.tags.map(String) : []),
        at, at,
      ],
    );
    return hydrateFinding(db.get('SELECT * FROM research_findings WHERE id = ?', [id]));
  };

  const listFindings = ({ buildHash = null, limit = 100 } = {}) => {
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    if (asNonEmptyString(buildHash)) {
      return db.all('SELECT * FROM research_findings WHERE build_hash = ? ORDER BY updated_at DESC LIMIT ?', [buildHash, capped]).map(hydrateFinding);
    }
    return db.all('SELECT * FROM research_findings ORDER BY updated_at DESC LIMIT ?', [capped]).map(hydrateFinding);
  };

  const exportBackup = () => ({
    schemaVersion: 1,
    exportedAt: new Date(now()).toISOString(),
    sources: listSources(),
    findings: listFindings({ limit: 500 }),
  });

  return {
    registerSource,
    getSource,
    listSources,
    updateSource,
    deleteSource,
    upsertDocument,
    markMissingDocsStale,
    listDocumentsBySource,
    search,
    recordFinding,
    listFindings,
    exportBackup,
    close: () => db.close(),
  };
};
