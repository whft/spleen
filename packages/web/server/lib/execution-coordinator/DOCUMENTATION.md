# Execution Coordinator (`packages/web/server/lib/execution-coordinator/`)

Authoritative per-session execution coordinator, non-blocking lane scheduler, and shared `$0`-verified OpenCode Zen provider cooldown gate for Spleen's autonomous harness.

## Responsibilities

1. **Per-Session Execution Ownership & Epoch Fencing (`coordinator.js`)**
   - Serializes prompt dispatch per `sessionId` so `autonomy`, `session-recovery`, `session-goal`, `message-queue`, `teams`, and `scheduled-tasks` can never send competing continuations to the same OpenCode session simultaneously.
   - Enforces deterministic dispatch priority when a session becomes idle:
     1. Explicit user sends and `message-queue` items (`interactive` / `queue`).
     2. Interrupted-turn and usage-limit recovery (`recovery`).
     3. Active session controller (`autonomy`, `team`, `session-goal`, `scheduled`).
   - Maintains a monotonic `epoch` per session and aborts both the local worker `AbortController` and OpenCode's live execution (including active child subagent sessions) on pause, cancel, or emergency stop.

2. **Lane-Based Concurrency (`lanes.js`)**
   - Separates execution capacity across `interactive`, `recovery`, `autonomy`, `team`, `subagent`, and `scheduled` lanes so long-running tasks never head-of-line block unrelated objectives or interactive chats.

3. **Shared Provider Gate & Free Zen Model Failover (`provider-gate.js`)**
   - Persists per-`(providerID, modelID, credentialID)` rate-limit and quota reset windows in SQLite across restarts.
   - Discovers verified `$0`-cost OpenCode Zen models from OpenCode's model catalog (`input === 0 && output === 0`), strictly refusing any model with non-zero or unknown pricing unless explicitly configured as the user's `fallbackModel`.
   - Tracks temporary session model failovers and restores the primary model once its cooldown window resets.
