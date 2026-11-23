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
| `attempts` | crash resumes sent for this interruption |
| `provider_waits` | continuation prompts sent for the current provider-limit series |
| `resumed_at` | when the last continuation prompt was accepted |
| `next_wake_at` | earliest next reconcile action |
| `resume_message_id` | inbox id returned by the resume prompt |
| `checkpoint` | reserved for the last confirmed cursor/tool summary |
| `last_error` | the decision reason or the error type the revive pass matches |

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
| `session.execution.failed` | `waiting_provider` at the reset when a provider usage limit stopped it, else `failed` with the error name |
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
| transcript ends in a provider usage limit, its reset is still ahead | keep `waiting_provider` until that reset |
| transcript ends in a provider usage limit, its reset has passed | resume, even when the failed assistant turn is complete |
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
transcript: it is the plain word `Continue.` and nothing else. It carries
`metadata.spleenRecovery = { sessionID, executionSeq, attempt }`; the next
reconciliation sees that user message and does not send a second resume.

A provider limit parks the row as `waiting_provider` at the reset time the error
names (`retryAfterMs` or the body's reset hints, anchored at the failure) or at
an hour out, doubling per pass to 24 hours. A named reset farther than five
minutes away gets one five-minute probe first, because a free-limit window can
clear earlier than the provider's hint; if the probe is still limited, the
named reset or the backoff applies. When the reset passes, the next
reconciliation resumes the chat even though the failed assistant message is
marked complete: the limit, not a crash, stopped the turn. Provider-limit waits
are not bounded by the
two-attempt crash budget: each continuation increments `provider_waits`, while
`attempts` counts only crash resumes. A limit that repeats after a continuation
never wakes sooner than the backoff for its `provider_waits`, so a provider that
keeps naming a short reset cannot cause a tight continuation loop. A 429 on the
prompt POST counts as a provider wait too, so a rate-limited prompt endpoint
cannot be retried at its short hint either. A continuation the backend accepted
but has not yet written to the transcript is awaited for 30s, up to 10 minutes
from its send, instead of re-parking the previous limit error or sending a
second prompt; past that the row goes to review. Any other failure backs off
30s, then 60s and spends an attempt.

At startup the same check runs on the transcript, so a limit reached while the
app was closed is parked or resumed as well; the wait starts from the assistant
message's completion time, not from the restart. Rows an earlier build had
already marked `failed` with a limit error are parked once at startup (last
35 days, 30s apart) and continue through the same path; a revived row starts
with a fresh crash budget and a fresh limit backoff.

## Subagents and OpenCode Zen usage limits

Automatic `Continue.` after a provider usage limit is scoped by default to OpenCode Zen / Go providers (`opencode`, `opencode-zen`, `opencode-go`). Non-Zen providers (such as Anthropic, OpenAI, or ChatGPT limits) park as `waiting_provider` with `provider limit (manual resume)` and wait for explicit user resume or configured limit-failover instead of sending automatic continuations.

Children (`parent_session_id`) follow two rules:

- **Crash recovery** resumes the parent first so parent and child do not redo the same work. A child stays `waiting_parent` until its parent settles.
- **Usage-limit stops** resume every stopped OpenCode Zen chat and subagent once the reset window passes, even while the parent is `running` (waiting on the subagent's task tool) or also resuming. A reconciliation pass also scans recent failed/interrupted Zen sessions and subagents so sessions whose usage stop happened during an SSE gap or before restart are enrolled and continued.

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
- A waiting chat shows nothing new until it resumes; the ledger keeps the state,
  but the clients have no recovery banner yet.
- A limit that names no reset is retried after 1h, 2h, 4h and so on up to 24h,
  so a long weekly or monthly limit costs one continuation prompt per pass. A
  long named reset gets one 5-minute probe first, which recovers a limit that
  clears early at the cost of one possibly-refused request.
- The ledger keeps one row per session; the `recovery_events` table holds the
  history needed for audits.
- A resumed turn that crashes again starts a new execution event; the attempt
  count is preserved only while the row is `recovering` (verified in
  `store.test.js`).

## Verification

- `packages/web`: `vitest run server/lib/session-recovery/` — 33 tests, including
  ten crashed chats with children resumed once each, quota parking and
  continuation, short-reset backoff, parent links read from session info, lease
  exclusivity and attempt accounting.
- Real backend, 2026-11-18: turn with a running `sleep` tool, `spleen.exe`
  force-killed, app restarted; ledger recorded `resume.sent`, the resumed
  execution started and completed, and no duplicate turn appeared.
- The interrupted turn's row read `completed` with reason
  `no unfinished turn` after the backend finished it.
