import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SCHEMA_VERSION = 3;

const TERMINAL_STATES = new Set(['completed', 'failed', 'needs_review']);

const isPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS executions (
    session_id TEXT PRIMARY KEY,
    parent_session_id TEXT,
    directory TEXT,
    execution_seq INTEGER,
    state TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_event_seq INTEGER,
    checkpoint TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_wake_at INTEGER,
    resume_message_id TEXT,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS executions_pending ON executions(state, next_wake_at);

  CREATE TABLE IF NOT EXISTS tool_outcomes (
    session_id TEXT NOT NULL,
    tool_id TEXT NOT NULL,
    name TEXT NOT NULL,
    input TEXT,
    status TEXT NOT NULL,
    executed INTEGER NOT NULL DEFAULT 0,
    external INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, tool_id)
  );

  CREATE TABLE IF NOT EXISTS recovery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    type TEXT NOT NULL,
    session_id TEXT,
    detail TEXT
  );

  CREATE TABLE IF NOT EXISTS recovery_lease (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO recovery_lease (id, owner, expires_at) VALUES (1, '', 0);
  `,
  `
  ALTER TABLE executions ADD COLUMN provider_waits INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE executions ADD COLUMN resumed_at INTEGER;
  `,
];

const loadDatabaseSync = () => {
  const builtin = globalThis.process?.getBuiltinModule?.('node:sqlite');
  if (builtin?.DatabaseSync) return builtin.DatabaseSync;
  return createRequire(import.meta.url)('node:sqlite').DatabaseSync;
};

const openRecoveryDatabase = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)));
  for (let version = 1; version <= SCHEMA_VERSION; version += 1) {
    if (applied.has(version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[version - 1]);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
};

export const createRecoveryStore = ({ filePath, now = Date.now }) => {
  const db = openRecoveryDatabase(filePath);
  const statements = {
    upsertExecution: db.prepare(`
      INSERT INTO executions (
        session_id, parent_session_id, directory, execution_seq, state,
        started_at, updated_at, checkpoint, attempts, next_wake_at, resume_message_id, last_error
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, NULL, 0, NULL, NULL, NULL)
      ON CONFLICT(session_id) DO UPDATE SET
        parent_session_id = COALESCE(excluded.parent_session_id, executions.parent_session_id),
        directory = COALESCE(excluded.directory, executions.directory),
        execution_seq = excluded.execution_seq,
        state = 'running',
        updated_at = excluded.updated_at,
        -- A started execution that follows a Spleen resume keeps the attempt
        -- count; a real new turn starts a fresh budget.
        attempts = CASE WHEN executions.state = 'recovering' THEN executions.attempts ELSE 0 END,
        next_wake_at = CASE WHEN executions.state = 'recovering' THEN executions.next_wake_at ELSE NULL END,
        resume_message_id = CASE WHEN executions.state = 'recovering' THEN executions.resume_message_id ELSE NULL END,
        provider_waits = CASE WHEN executions.state = 'recovering' THEN executions.provider_waits ELSE 0 END,
        resumed_at = CASE WHEN executions.state = 'recovering' THEN executions.resumed_at ELSE NULL END,
        last_error = NULL
    `),
    getExecution: db.prepare('SELECT * FROM executions WHERE session_id = ?'),
    listPending: db.prepare(`
      SELECT * FROM executions WHERE state NOT IN ('completed', 'failed', 'needs_review') ORDER BY started_at ASC
    `),
    listAll: db.prepare('SELECT * FROM executions ORDER BY updated_at DESC LIMIT 200'),
    listFailedSince: db.prepare("SELECT * FROM executions WHERE state = 'failed' AND updated_at > ? ORDER BY updated_at DESC"),
    setState: db.prepare('UPDATE executions SET state = ?, updated_at = ?, last_error = ? WHERE session_id = ?'),
    finish: db.prepare(`
      UPDATE executions SET state = ?, updated_at = ?, last_error = ?, next_wake_at = NULL, provider_waits = 0, resumed_at = NULL WHERE session_id = ?
    `),
    touch: db.prepare('UPDATE executions SET updated_at = ?, last_event_seq = ? WHERE session_id = ?'),
    schedule: db.prepare(`
      UPDATE executions SET state = ?, updated_at = ?, attempts = ?, next_wake_at = ?, resume_message_id = ?, last_error = ?,
        provider_waits = COALESCE(?, provider_waits), resumed_at = COALESCE(?, resumed_at)
      WHERE session_id = ?
    `),
    checkpoint: db.prepare('UPDATE executions SET checkpoint = ?, updated_at = ? WHERE session_id = ?'),
    tool: db.prepare(`
      INSERT INTO tool_outcomes (session_id, tool_id, name, input, status, executed, external, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, tool_id) DO UPDATE SET
        status = excluded.status,
        executed = excluded.executed,
        updated_at = excluded.updated_at
    `),
    toolStatus: db.prepare('SELECT status FROM tool_outcomes WHERE session_id = ? AND tool_id = ?'),
    tools: db.prepare('SELECT * FROM tool_outcomes WHERE session_id = ? ORDER BY updated_at ASC'),
    event: db.prepare('INSERT INTO recovery_events (at, type, session_id, detail) VALUES (?, ?, ?, ?)'),
    recentEvents: db.prepare('SELECT * FROM recovery_events ORDER BY id DESC LIMIT 100'),
    parent: db.prepare('UPDATE executions SET parent_session_id = ?, updated_at = ? WHERE session_id = ?'),
    acquire: db.prepare(`
      INSERT INTO recovery_lease (id, owner, expires_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
      WHERE recovery_lease.expires_at <= ? OR recovery_lease.owner = excluded.owner
    `),
    forceLease: db.prepare('UPDATE recovery_lease SET owner = ?, expires_at = ? WHERE id = 1 AND owner = ?'),
    wakeWaiting: db.prepare("UPDATE executions SET next_wake_at = ?, updated_at = ? WHERE state = 'waiting_provider'"),
    readLease: db.prepare('SELECT owner, expires_at FROM recovery_lease WHERE id = 1'),
    release: db.prepare("UPDATE recovery_lease SET owner = '', expires_at = 0 WHERE id = 1 AND owner = ?"),
  };

  const recordEvent = (type, sessionID, detail = null, at = now()) => {
    statements.event.run(at, type, sessionID ?? null, detail === null ? null : JSON.stringify(detail));
  };

  return {
    filePath,

    beginExecution({ sessionID, parentSessionID = null, directory = null, seq = null, at = now() }) {
      statements.upsertExecution.run(
        sessionID,
        parentSessionID,
        directory,
        Number.isFinite(seq) ? Math.trunc(seq) : null,
        at,
        at,
      );
      recordEvent('execution.started', sessionID, { seq }, at);
    },

    noteTool({ sessionID, toolID, name, input = null, status, executed = 0, external = 0, at = now() }) {
      if (!sessionID || !toolID) return;
      statements.tool.run(
        sessionID,
        toolID,
        name || 'unknown',
        input === null ? null : JSON.stringify(input),
        status,
        executed ? 1 : 0,
        external ? 1 : 0,
        at,
      );
      const existing = statements.getExecution.get(sessionID);
      if (existing && existing.state === 'running') {
        statements.touch.run(at, null, sessionID);
        // A resumed execution that completes real tool work succeeded; reset its
        // provider limit backoff so any later burst limit continues quickly again.
        if (status === 'completed' && Number(existing.provider_waits) > 0) {
          statements.schedule.run(
            'running',
            at,
            Number(existing.attempts) || 0,
            null,
            existing.resume_message_id ?? null,
            existing.last_error ?? null,
            0,
            existing.resumed_at ?? null,
            sessionID,
          );
        }
      }
      recordEvent(`tool.${status}`, sessionID, { toolID, name }, at);
    },

    noteToolStatus(sessionID, toolID) {
      return statements.toolStatus.get(sessionID, toolID)?.status ?? null;
    },

    toolsFor(sessionID) {
      return statements.tools.all(sessionID).map((row) => ({
        toolID: row.tool_id,
        name: row.name,
        status: row.status,
        executed: row.executed === 1,
        external: row.external === 1,
      }));
    },

    noteEvent(sessionID, seq, at = now()) {
      if (!sessionID || !Number.isFinite(seq)) return;
      statements.touch.run(at, Math.trunc(seq), sessionID);
    },

    noteParent(sessionID, parentSessionID, at = now()) {
      if (!sessionID || !parentSessionID || sessionID === parentSessionID) return;
      statements.parent.run(parentSessionID, at, sessionID);
      recordEvent('parent.linked', sessionID, { parentSessionID }, at);
    },

    saveCheckpoint(sessionID, checkpoint, at = now()) {
      statements.checkpoint.run(JSON.stringify(checkpoint), at, sessionID);
    },

    finish(sessionID, state, { error = null, at = now() } = {}) {
      statements.finish.run(state, at, error, sessionID);
      recordEvent(`execution.${state}`, sessionID, { error }, at);
    },

    markNeedsReview(sessionID, reason, at = now()) {
      statements.finish.run('needs_review', at, reason, sessionID);
      recordEvent('needs_review', sessionID, { reason }, at);
    },

    schedule(sessionID, { state, attempts, nextWakeAt = null, resumeMessageID = null, error = null, providerWaits = null, resumedAt = null, at = now() }) {
      statements.schedule.run(state, at, attempts, nextWakeAt, resumeMessageID, error, providerWaits, resumedAt, sessionID);
    },

    get(sessionID) {
      return statements.getExecution.get(sessionID) ?? null;
    },

    pending() {
      return statements.listPending.all();
    },

    all() {
      return statements.listAll.all();
    },

    failedSince(since) {
      return statements.listFailedSince.all(Number(since) || 0);
    },

    recentEvents() {
      return statements.recentEvents.all();
    },

    noteRecovery(type, sessionID, detail = null, at = now()) {
      recordEvent(type, sessionID, detail, at);
    },

    isTerminal(state) {
      return TERMINAL_STATES.has(state);
    },

    tryAcquireLease(owner, ttlMs, at = now()) {
      statements.acquire.run(owner, at + ttlMs, at);
      const lease = statements.readLease.get();
      if (lease?.owner === owner) return true;
      const match = typeof lease?.owner === 'string' ? lease.owner.match(/^(\d+)-/) : null;
      if (match) {
        const pid = Number.parseInt(match[1], 10);
        if (pid !== process.pid && !isPidAlive(pid)) {
          statements.forceLease.run(owner, at + ttlMs, lease.owner);
          return statements.readLease.get()?.owner === owner;
        }
      }
      return false;
    },

    wakeWaitingProvider(at = now()) {
      return Number(statements.wakeWaiting.run(at, at)?.changes) || 0;
    },

    renewLease(owner, ttlMs, at = now()) {
      return this.tryAcquireLease(owner, ttlMs, at);
    },

    releaseLease(owner) {
      statements.release.run(owner);
    },

    close() {
      db.close();
    },
  };
};
