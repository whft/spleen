# Autonomy Supervisor & Durable Objective Engine (`packages/web/server/lib/autonomy/`)

Production-grade autonomous objective orchestrator for Spleen. Coordinates finite and ongoing multi-agent objectives with SQLite durability, parallel DAG execution, renewable activity-aware leases, usage-limit immunity, compaction continuity, and real session interruption.

## Module Map

| File | Responsibility |
| --- | --- |
| `store.js` | SQLite persistence (`objectives`, `tasks`, `verifications`, `autonomy_events`, `autonomy_checkpoints`), backward-compatible `ALTER TABLE` schema migrations, `claimTaskForExecution`, `renewTaskLease`, and `updateTaskIfEpoch` CAS fencing. |
| `supervisor.js` | Event-driven + fallback-reconciled `AutonomySupervisor` managing concurrent `inFlight` worker fibers across lanes, parallel task fan-out (`maxParallel`), `waiting_provider` deferral, pause/cancel/emergency-stop interruption, and semantic stagnation replanning. |
| `supervisor-settlement.js` | Pure task/objective settlement helpers: stagnation hashing, downstream dependency blocking (`propagateBlockedDownstream`), `replan` task generation, `ongoing` cycle scheduling, and `MemFS` procedural failure-lesson persistence. |
| `executor.js` | `AutonomySessionExecutor` handling confirmed-delivery OpenCode dispatch, baseline `afterIdleId` verification, `backend_unavailable` vs `idle` distinction, subagent/background-job lease renewal, Git worktree isolation (`moveToWorktree`), and usage-limit deferral. |
| `prompt-builder.js` | Structured task prompt synthesis combining objective status, completed/failed task history, verification evidence, `Compaction Continuity Anchor`, latest checkpoint, dependency handoffs, and `<spleen-recalled-context>` memories. |
| `compaction-bridge.js` | Subscribes to `globalEventHub` session compaction events, records durable `compaction` checkpoints (`compactionEpoch`), flushes episodic memory snapshots to `MemFS`, and strips `<spleen-recalled-context>` tags to prevent recall loops. |
| `bootstrap.js` | Wires `AutonomyStore`, `AutonomySessionExecutor`, `AutonomyCompactionBridge`, `AutonomySupervisor`, `ExecutionCoordinator`, and `ProviderGate` into the Spleen server runtime. |
| `routes.js` | Express REST surface under `/api/autonomy/*` for objective CRUD, pause/resume/cancel/run-turn/verify/emergency-stop, coordinator diagnostics, and cooldown clearing. |

## Core Invariants

### 1. Confirmed Delivery & Post-Baseline Completion
A task turn is **never** marked `ok: true` merely because `dispatchPrompt` returned without throwing:
1. Before dispatch, `executor.js` captures the session's latest completed assistant message ID (`baselineMessageId`) and timestamp (`baselineTs`).
2. After dispatch, `waitForTurnCompletion` requires an assistant turn newer than `baselineMessageId` (`afterIdleId`) with a valid completion timestamp (`completedAt >= baselineTs`) and non-empty output or tool evidence.
3. If `readSessionStatus` returns `null` (OpenCode sidecar restarting or temporarily unreachable), the executor treats the poll as `backend_unavailable` rather than `idle` or `failed`, preserving the running turn cleanly.

### 2. Renewable Activity-Aware Leases
- `store.claimTaskForExecution` acquires an initial lease (`now + leaseMs`, default `180_000ms`).
- Every heartbeat inside `executor.js` invokes `store.renewTaskLease(taskId, runEpoch, leaseMs)`, advancing **both** `heartbeatAt` and `leaseUntil`.
- While the target session is `busy`/`retry`, OR `sessionActivityProbe` detects working child subagent sessions (`hasWorkingDescendants`) or active background jobs (`fetchRunningBackgroundJobs`), the inactivity timer resets and the lease renews continuously. Only genuinely dead/orphaned workers expire their lease and get recovered on the next supervisor pass.

### 3. Epoch-Fenced Cancellation (`runEpoch`)
- Every objective carries a monotonically increasing `runEpoch`.
- `pauseObjective`, `cancelObjective`, and `emergencyStopAll` atomically increment `runEpoch`, abort all in-flight `AbortController`s for that objective, and call `executionCoordinator.interruptSession` (which aborts both the primary OpenCode session and any active child subagent sessions).
- `store.updateTaskIfEpoch(taskId, expectedEpoch, patch)` rejects any late completion or error arriving from a superseded worker fiber (`stale: true`).

### 4. Finite vs. Ongoing Objectives
- **Finite (`mode: 'finite'`)**: Completes only when every task in the DAG has succeeded AND all configured `verificationCommands` exit with code `0` (`passed`). Verification failures automatically spawn a targeted remediation task (`Fix verification failure: <cmd>`).
- **Ongoing (`mode: 'ongoing'`)**: Defaults to `maxTurns: null` (unlimited) and `maxRuntimeMs: null`. Cycles through work -> verification -> sleep (`waiting` until `nextWakeAt = now + reviewIntervalMs`) -> automatic wake indefinitely until paused, cancelled, or an explicit user budget is reached.

### 5. Usage-Limit Immunity & `$0` Zen Failover
- When an execution turn encounters a rate limit, quota exhaustion, or `provider.free-limit` (`429`), `executor.js` returns `{ ok: false, limitHit: true, retryAt }`.
- `supervisor-settlement.js` transitions the task back to `pending` with `attempts` **unchanged** (`providerWaits + 1`), keeps `failureStreak` unchanged, parks the objective with `waitingReason = 'waiting_provider'` and `waitingUntil = retryAt`, and arms a wake timer for exact automatic continuation.
- Simultaneously, `ProviderGate` + `LimitFailoverRuntime` can switch eligible sessions onto verified `$0`-cost `opencode` Zen free models (`input === 0 && output === 0`, excluding subscription-gated `opencode-go` and all paid models) and automatically restore the primary model once its cooldown expires.
