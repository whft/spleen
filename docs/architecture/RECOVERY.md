# Durable session recovery

The authoritative contract, schema and decision table live in
`packages/web/server/lib/session-recovery/DOCUMENTATION.md`. This page is the
short version for operators.

## What is guaranteed

- A turn Spleen observed as running is remembered in `recovery.sqlite3` until it
  reaches a terminal state.
- After a restart the coordinator re-reads the session and its newest messages.
  It never trusts a session-level outcome over an unfinished transcript.
- Only one process resumes per data directory (SQLite lease, 60s TTL, 20s
  heartbeat); a crashed owner's lease expires and is taken over.
- A resume carries `metadata.spleenRecovery`; seeing that user message again
  means the resume was delivered, so it is not sent twice.
- The continuation prompt is a plain `Continue.`; the transcript carries the
  rest.
- Provider limits park the session as `waiting_provider` at the reset time
  without spending the resume budget.

## What is not guaranteed

- Exactly-once **external** side effects. A tool could have succeeded without its
  result reaching the transcript, and the continuation prompt does not warn about
  it: a destructive action after a restart still needs a human check.
- Session-level `outcome` is not per-turn. It is only used once the transcript
  has no unfinished turn.
- Child sessions are resumed after their parent, never before.
- Recovery state lives on the local machine. Another device connected to the
  same server sees the result, not the coordinator.

## Evidence

- 15 unit/integration tests: `packages/web`: `vitest run server/lib/session-recovery/`.
- Real crash: force-kill during a running tool, restart, `resume.sent` → resumed
  execution completed; no duplicate turn. Recorded in
  `docs/roadmap/PROGRESS.md`.

## Operations

- Status: `GET /api/recovery/status` (authenticated) returns coordinator state,
  per-state counts and the newest rows.
- Ledger: `%APPDATA%\Spleen\recovery.sqlite3`; delete it only while Spleen is
  stopped, and expect no automatic resume for turns recorded before.
- If a row is `needs_review`, the user decides; Spleen does not send anything.
