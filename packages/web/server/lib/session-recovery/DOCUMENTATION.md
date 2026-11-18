# Session Recovery

Durable supervision of OpenCode turns across app crashes, restarts, provider
limits and forced kills. One coordinator per data directory owns recovery; the
backend's transcript stays authoritative and Spleen never replays a turn it has
not proven unfinished.

## Ownership

This module owns the recovery ledger (`recovery.sqlite3`), the coordinator
lease, reconciliation of durable executions against OpenCode, and the
continuation prompt. OpenCode owns execution, message storage and tool side
effects. The desktop host owns the sidecar lifecycle; the server starts and
stops this runtime with the rest of its runtimes (`shutdown-runtime.js`).

## Files

- `store.js`: SQLite ledger (WAL), schema migration, executions, tool evidence,
  audit events and the coordinator lease.
- `reconciler.js`: pure decisions (`decideRecovery`) and the resume prompt
  (`buildResumePrompt`). No I/O.
- `runtime.js`: event intake, startup reconciliation, bounded resume sending,
  provider cooldown, broadcasts and the status snapshot.
- `opencode-fetch.js`: authenticated OpenCode HTTP with envelope unwrapping and
  the retry hint of a rate-limit response.
- `runtime.test.js`, `store.test.js`: crash/restart matrices and lease tests.

The runtime subscribes to the **raw** global hub events, not translated ones:
translation drops execution ids, durable sequence numbers and tool `executed`
flags, which are exactly the evidence recovery needs.

## State

`executions` has one row per session (the latest observed execution):

| column | meaning |
|---|---|
| `state` | see transition table below |
| `execution_seq` | `durable.seq` of `session.execution.started` |
| `attempts` | Spleen resumes sent for this interruption |
| `next_wake_at` | earliest next reconcile action |
| `resume_message_id` | inbox id returned by the resume prompt |
| `checkpoint` | reserved for the last confirmed cursor/tool summary |
| `last_error` | the decision reason, for the status route |

`tool_outcomes` keeps `(session_id, tool_id)` with name, status, and whether the
tool was executed. `recovery_events` is the audit trail of starts, outcomes,
resumes and review decisions. Both are evidence for a later resume, never a
source of truth over the transcript.

States: `running`, `recovering`, `waiting_parent`, `waiting_provider`,
`waiting_user`, `unknown`, `completed`, `failed`, `needs_review`. `completed`,
`failed` and `needs_review` are terminal.

## Event intake

| wire event | ledger effect |
|---|---|
| `session.execution.started` | begin/restart the row, record seq |
| `session.execution.succeeded` | `completed` |
| `session.execution.failed` | `failed` with the error name |
| `session.execution.interrupted` | `user` → completed; anything else → `recovering` with a short wake |
| `session.tool.called` | tool intent, `executed` flag from the event |
| `session.tool.success` / `session.tool.failed` | tool outcome |
| `session.updated` and other events | ignored here |

A `shutdown` interruption never reaches Spleen: the process is gone. That case
is reconstructed from the ledger on the next start.

## Reconciliation

On start, and on every hub reconnect and 30s poll, the coordinator:

1. Takes the lease (`BEGIN IMMEDIATE`, 60s TTL, 20s heartbeat). A process that
   cannot take it observes only; a crashed owner's lease expires and the next
   heartbeat of the new process takes over.
2. Reads `GET /api/session/active`. If that read fails, every pending row waits
   15s; a running backend is never assumed absent.
3. For each pending row reads the session and the newest 60 messages.
4. Decides (`decideRecovery`):

| evidence | action |
|---|---|
| session missing | `needs_review` |
| session is active | `attach` (`running`) |
| messages unreadable | `unknown`, retry in 15s |
| transcript has no unfinished assistant turn | `completed`, or `failed` when the session outcome says failed |
| unfinished turn, a Spleen resume marker is the last user message and no assistant followed | `recovering`, retry after 30s; `needs_review` after 10 min |
| unfinished turn and the resume budget is spent (2) | `needs_review` |
| unfinished turn inside its backoff window | `recovering` until `next_wake_at` |
| unfinished turn, backend idle | resume |

The transcript, not `Session.Info.outcome`, decides whether a turn is pending.
An outcome can belong to an earlier turn: a session that had succeeded before a
crash still reports `succeeded` while its last assistant turn has a running
tool, and trusting it would close a turn that still needs recovery. Observed in
the real crash run on 2026-11-18.

A resume is not sent during the first 10 seconds after the runtime starts, so a
slow OpenCode startup is not mistaken for an orphaned turn.

## Resume

The continuation prompt goes into the same session, so the model already has the
transcript. It adds only: the original request (clipped), completed tool calls it
must not repeat, tool calls whose outcome is unknown and must be inspected
before repeating, child-session results, and an instruction not to create a
duplicate subagent. It carries
`metadata.spleenRecovery = { sessionID, executionSeq, attempt }`; the next
reconciliation sees that user message and does not send a second resume.

A provider limit (HTTP 429 or a quota/rate message) parks the row as
`waiting_provider` at the reset time or 15 minutes out, and does not spend the
resume budget. Any other failure backs off 30s, then 60s and spends an attempt.

## Subagents

Children (`parent_session_id`) are resumed only when their parent is not itself
pending. A pending parent resumes first and receives the child states and
summaries in its prompt; resuming a child first risks two agents redoing the
same work. A child past its parent's recovery stays `waiting_parent` until the
parent settles, then reconciles on its own.

## Coordinator and DB

`recovery.sqlite3` sits in `SPLEEN_DATA_DIR`; `journal_mode=WAL`,
`synchronous=NORMAL`, `busy_timeout=5000`. Migrations are inline SQL, applied in
a transaction and recorded in `schema_migrations`. Node's `node:sqlite` builtin
is used so the same code runs in Node tests and in the Bun-compiled sidecar.

## Limitations

- Exactly-once **external** side effects cannot be guaranteed. A tool that
  succeeded but whose success never reached the transcript is listed as unknown
  and the model is told to verify before repeating it.
- `Session.Info.outcome` is not per-turn; only the transcript tail is trusted.
- Children are not resumed before their parent by design.
- The ledger keeps one row per session; the `recovery_events` table holds the
  history needed for audits.
- A resumed turn that crashes again starts a new execution event; the attempt
  count is preserved only while the row is `recovering` (verified in
  `store.test.js`).

## Verification

- `packages/web`: `vitest run server/lib/session-recovery/` — 15 tests, including
  ten crashed chats with children resumed once each, quota parking, lease
  exclusivity and attempt accounting.
- Real backend, 2026-11-18: turn with a running `sleep` tool, `spleen.exe`
  force-killed, app restarted; ledger recorded `resume.sent`, the resumed
  execution started and completed, and no duplicate turn appeared.
- The interrupted turn's row read `completed` with reason
  `no unfinished turn` after the backend finished it.
