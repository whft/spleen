import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { loadSqliteOpener } from '../message-search/sqlite.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  directory TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'finite',
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 50,
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  verification_commands_json TEXT NOT NULL DEFAULT '[]',
  budget_json TEXT NOT NULL DEFAULT '{}',
  loop_phase TEXT NOT NULL DEFAULT 'objective',
  session_id TEXT,
  team_id TEXT,
  turns_used INTEGER NOT NULL DEFAULT 0,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_review_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  role TEXT NOT NULL DEFAULT 'engineer',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 50,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT,
  checkpoint_json TEXT,
  result TEXT,
  error TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_owner TEXT,
  lease_until INTEGER,
  heartbeat_at INTEGER,
  next_retry_at INTEGER,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autonomy_tasks_obj ON tasks(objective_id, status);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL,
  task_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autonomy_decisions_obj ON decisions(objective_id, created_at);
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL,
  checks_json TEXT NOT NULL DEFAULT '[]',
  git_diff_summary TEXT,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autonomy_verifications_obj ON verifications(objective_id, created_at);
`;

const parseJson = (raw, fallback) => {
  const s = asNonEmptyString(raw);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

const hydrateObjective = (row) => (!row ? null : ({
  id: row.id,
  title: row.title,
  description: row.description,
  directory: row.directory,
  mode: row.mode,
  status: row.status,
  priority: Number(row.priority ?? 50),
  acceptanceCriteria: parseJson(row.acceptance_criteria_json, []),
  verificationCommands: parseJson(row.verification_commands_json, []),
  budget: parseJson(row.budget_json, {}),
  loopPhase: row.loop_phase,
  sessionId: row.session_id ?? null,
  teamId: row.team_id ?? null,
  turnsUsed: Number(row.turns_used ?? 0),
  failureStreak: Number(row.failure_streak ?? 0),
  lastError: row.last_error ?? null,
  nextReviewAt: row.next_review_at ? Number(row.next_review_at) : null,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
  completedAt: row.completed_at ? Number(row.completed_at) : null,
}));

const hydrateTask = (row) => (!row ? null : ({
  id: row.id,
  objectiveId: row.objective_id,
  title: row.title,
  prompt: row.prompt,
  kind: row.kind,
  role: row.role,
  status: row.status,
  priority: Number(row.priority ?? 50),
  dependsOn: parseJson(row.depends_on_json, []),
  idempotencyKey: row.idempotency_key ?? null,
  checkpoint: parseJson(row.checkpoint_json, null),
  result: row.result ?? null,
  error: row.error ?? null,
  artifacts: parseJson(row.artifacts_json, []),
  attempts: Number(row.attempts ?? 0),
  maxAttempts: Number(row.max_attempts ?? 3),
  leaseOwner: row.lease_owner ?? null,
  leaseUntil: row.lease_until ? Number(row.lease_until) : null,
  heartbeatAt: row.heartbeat_at ? Number(row.heartbeat_at) : null,
  nextRetryAt: row.next_retry_at ? Number(row.next_retry_at) : null,
  sessionId: row.session_id ?? null,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
}));

export const createAutonomyStore = ({ dbPath = ':memory:', now = () => Date.now() } = {}) => {
  const openSqlite = loadSqliteOpener();
  if (!openSqlite) throw new Error('SQLite runtime unavailable for Autonomy store');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = openSqlite(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA_SQL);

  const createObjective = (input = {}) => {
    const at = now();
    const id = asNonEmptyString(input.id) || `obj_${crypto.randomBytes(6).toString('hex')}`;
    const budget = isRecord(input.budget) ? input.budget : {};
    const mode = input.mode === 'ongoing' ? 'ongoing' : 'finite';
    const normalizedBudget = {
      maxTurns: Math.max(1, Math.min(500, Number(budget.maxTurns) || (mode === 'ongoing' ? 100 : 25))),
      maxRuntimeMs: Math.max(60_000, Number(budget.maxRuntimeMs) || 3_600_000),
      maxParallel: Math.max(1, Math.min(8, Number(budget.maxParallel) || 2)),
      reviewIntervalMs: Math.max(10_000, Number(budget.reviewIntervalMs) || 30_000),
    };
    db.run(
      `INSERT INTO objectives (
        id, title, description, directory, mode, status, priority,
        acceptance_criteria_json, verification_commands_json, budget_json,
        loop_phase, session_id, team_id, turns_used, failure_streak,
        last_error, next_review_at, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, NULL)`,
      [
        id,
        asNonEmptyString(input.title) || 'Untitled Objective',
        asNonEmptyString(input.description) || asNonEmptyString(input.title) || '',
        asNonEmptyString(input.directory) || process.cwd(),
        mode,
        asNonEmptyString(input.status) || 'active',
        Number.isFinite(Number(input.priority)) ? Number(input.priority) : 50,
        JSON.stringify(Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria.map(String) : []),
        JSON.stringify(Array.isArray(input.verificationCommands) ? input.verificationCommands.map(String) : []),
        JSON.stringify(normalizedBudget),
        asNonEmptyString(input.loopPhase) || 'objective',
        asNonEmptyString(input.sessionId),
        asNonEmptyString(input.teamId),
        mode === 'ongoing' ? at + normalizedBudget.reviewIntervalMs : null,
        at,
        at,
      ],
    );
    return getObjective(id);
  };

  const getObjective = (id) => hydrateObjective(db.get('SELECT * FROM objectives WHERE id = ?', [id]));

  const listObjectives = ({ status = null, directory = null, limit = 100 } = {}) => {
    const clauses = [];
    const params = [];
    if (asNonEmptyString(status)) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (asNonEmptyString(directory)) {
      clauses.push('directory = ?');
      params.push(directory);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    params.push(capped);
    return db.all(`SELECT * FROM objectives ${where} ORDER BY priority DESC, updated_at DESC LIMIT ?`, params).map(hydrateObjective);
  };

  const updateObjective = (id, patch = {}) => {
    const current = getObjective(id);
    if (!current) return null;
    const at = now();
    const next = {
      title: asNonEmptyString(patch.title) ?? current.title,
      description: asNonEmptyString(patch.description) ?? current.description,
      status: asNonEmptyString(patch.status) ?? current.status,
      priority: Number.isFinite(Number(patch.priority)) ? Number(patch.priority) : current.priority,
      acceptanceCriteria: Array.isArray(patch.acceptanceCriteria) ? patch.acceptanceCriteria : current.acceptanceCriteria,
      verificationCommands: Array.isArray(patch.verificationCommands) ? patch.verificationCommands : current.verificationCommands,
      budget: isRecord(patch.budget) ? { ...current.budget, ...patch.budget } : current.budget,
      loopPhase: asNonEmptyString(patch.loopPhase) ?? current.loopPhase,
      sessionId: patch.sessionId !== undefined ? asNonEmptyString(patch.sessionId) : current.sessionId,
      teamId: patch.teamId !== undefined ? asNonEmptyString(patch.teamId) : current.teamId,
      turnsUsed: Number.isFinite(Number(patch.turnsUsed)) ? Number(patch.turnsUsed) : current.turnsUsed,
      failureStreak: Number.isFinite(Number(patch.failureStreak)) ? Number(patch.failureStreak) : current.failureStreak,
      lastError: patch.lastError !== undefined ? asNonEmptyString(patch.lastError) : current.lastError,
      nextReviewAt: patch.nextReviewAt !== undefined ? (patch.nextReviewAt ? Number(patch.nextReviewAt) : null) : current.nextReviewAt,
      completedAt: patch.completedAt !== undefined ? (patch.completedAt ? Number(patch.completedAt) : null) : current.completedAt,
    };
    db.run(
      `UPDATE objectives SET
        title = ?, description = ?, status = ?, priority = ?,
        acceptance_criteria_json = ?, verification_commands_json = ?, budget_json = ?,
        loop_phase = ?, session_id = ?, team_id = ?, turns_used = ?,
        failure_streak = ?, last_error = ?, next_review_at = ?, updated_at = ?, completed_at = ?
      WHERE id = ?`,
      [
        next.title, next.description, next.status, next.priority,
        JSON.stringify(next.acceptanceCriteria), JSON.stringify(next.verificationCommands), JSON.stringify(next.budget),
        next.loopPhase, next.sessionId, next.teamId, next.turnsUsed,
        next.failureStreak, next.lastError, next.nextReviewAt, at, next.completedAt,
        id,
      ],
    );
    return getObjective(id);
  };

  const addTask = (objectiveId, input = {}) => {
    const idem = asNonEmptyString(input.idempotencyKey);
    if (idem) {
      const existing = db.get('SELECT * FROM tasks WHERE objective_id = ? AND idempotency_key = ?', [objectiveId, idem]);
      if (existing) return hydrateTask(existing);
    }
    const at = now();
    const id = asNonEmptyString(input.id) || `tsk_${crypto.randomBytes(6).toString('hex')}`;
    db.run(
      `INSERT INTO tasks (
        id, objective_id, title, prompt, kind, role, status, priority,
        depends_on_json, idempotency_key, checkpoint_json, result, error,
        artifacts_json, attempts, max_attempts, lease_owner, lease_until,
        heartbeat_at, next_retry_at, session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', 0, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      [
        id,
        objectiveId,
        asNonEmptyString(input.title) || 'Task',
        asNonEmptyString(input.prompt) || asNonEmptyString(input.title) || '',
        asNonEmptyString(input.kind) || 'general',
        asNonEmptyString(input.role) || 'engineer',
        asNonEmptyString(input.status) || 'pending',
        Number.isFinite(Number(input.priority)) ? Number(input.priority) : 50,
        JSON.stringify(Array.isArray(input.dependsOn) ? input.dependsOn.map(String) : []),
        idem,
        input.checkpoint ? JSON.stringify(input.checkpoint) : null,
        Math.max(1, Math.min(10, Number(input.maxAttempts) || 5)),
        asNonEmptyString(input.sessionId),
        at,
        at,
      ],
    );
    return getTask(id);
  };

  const getTask = (id) => hydrateTask(db.get('SELECT * FROM tasks WHERE id = ?', [id]));

  const listTasks = (objectiveId) => (
    db.all('SELECT * FROM tasks WHERE objective_id = ? ORDER BY priority DESC, created_at ASC', [objectiveId]).map(hydrateTask)
  );

  const updateTask = (id, patch = {}) => {
    const current = getTask(id);
    if (!current) return null;
    const at = now();
    const next = {
      status: asNonEmptyString(patch.status) ?? current.status,
      role: asNonEmptyString(patch.role) ?? current.role,
      priority: Number.isFinite(Number(patch.priority)) ? Number(patch.priority) : current.priority,
      dependsOn: Array.isArray(patch.dependsOn) ? patch.dependsOn : current.dependsOn,
      checkpoint: patch.checkpoint !== undefined ? patch.checkpoint : current.checkpoint,
      result: patch.result !== undefined ? patch.result : current.result,
      error: patch.error !== undefined ? patch.error : current.error,
      artifacts: Array.isArray(patch.artifacts) ? patch.artifacts : current.artifacts,
      attempts: Number.isFinite(Number(patch.attempts)) ? Number(patch.attempts) : current.attempts,
      leaseOwner: patch.leaseOwner !== undefined ? patch.leaseOwner : current.leaseOwner,
      leaseUntil: patch.leaseUntil !== undefined ? patch.leaseUntil : current.leaseUntil,
      heartbeatAt: patch.heartbeatAt !== undefined ? patch.heartbeatAt : current.heartbeatAt,
      nextRetryAt: patch.nextRetryAt !== undefined ? patch.nextRetryAt : current.nextRetryAt,
      sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
    };
    db.run(
      `UPDATE tasks SET
        status = ?, role = ?, priority = ?, depends_on_json = ?,
        checkpoint_json = ?, result = ?, error = ?, artifacts_json = ?,
        attempts = ?, lease_owner = ?, lease_until = ?, heartbeat_at = ?,
        next_retry_at = ?, session_id = ?, updated_at = ?
      WHERE id = ?`,
      [
        next.status, next.role, next.priority, JSON.stringify(next.dependsOn),
        next.checkpoint ? JSON.stringify(next.checkpoint) : null, next.result, next.error, JSON.stringify(next.artifacts),
        next.attempts, next.leaseOwner, next.leaseUntil, next.heartbeatAt,
        next.nextRetryAt, next.sessionId, at,
        id,
      ],
    );
    return getTask(id);
  };

  const recordDecision = ({ objectiveId, taskId = null, kind = 'plan', summary, details = {} }) => {
    const at = now();
    const id = `dec_${crypto.randomBytes(6).toString('hex')}`;
    db.run(
      'INSERT INTO decisions (id, objective_id, task_id, kind, summary, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, objectiveId, asNonEmptyString(taskId), asNonEmptyString(kind) || 'plan', String(summary || ''), JSON.stringify(details ?? {}), at],
    );
    return { id, objectiveId, taskId, kind, summary, details, createdAt: at };
  };

  const listDecisions = (objectiveId, limit = 100) => (
    db.all('SELECT * FROM decisions WHERE objective_id = ? ORDER BY created_at DESC LIMIT ?', [objectiveId, Math.max(1, Math.min(500, Number(limit) || 100))])
      .map((row) => ({
        id: row.id,
        objectiveId: row.objective_id,
        taskId: row.task_id ?? null,
        kind: row.kind,
        summary: row.summary,
        details: parseJson(row.details_json, {}),
        createdAt: Number(row.created_at),
      }))
  );

  const recordVerification = ({ objectiveId, taskId = null, status, checks = [], gitDiffSummary = '', summary = '' }) => {
    const at = now();
    const id = `ver_${crypto.randomBytes(6).toString('hex')}`;
    db.run(
      'INSERT INTO verifications (id, objective_id, task_id, status, checks_json, git_diff_summary, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, objectiveId, asNonEmptyString(taskId), status, JSON.stringify(checks), String(gitDiffSummary || ''), String(summary || ''), at],
    );
    return { id, objectiveId, taskId, status, checks, gitDiffSummary, summary, createdAt: at };
  };

  const listVerifications = (objectiveId, limit = 50) => (
    db.all('SELECT * FROM verifications WHERE objective_id = ? ORDER BY created_at DESC LIMIT ?', [objectiveId, Math.max(1, Math.min(200, Number(limit) || 50))])
      .map((row) => ({
        id: row.id,
        objectiveId: row.objective_id,
        taskId: row.task_id ?? null,
        status: row.status,
        checks: parseJson(row.checks_json, []),
        gitDiffSummary: row.git_diff_summary ?? '',
        summary: row.summary,
        createdAt: Number(row.created_at),
      }))
  );

  return {
    createObjective,
    getObjective,
    listObjectives,
    updateObjective,
    addTask,
    getTask,
    listTasks,
    updateTask,
    recordDecision,
    listDecisions,
    recordVerification,
    listVerifications,
    close: () => db.close(),
  };
};
