# Verification evidence

Only outcomes that were observed on this machine are listed. Commands run from
the repository root unless a directory is named.

## Build and static checks

| Command | Result |
|---|---|
| `bun install` | pass, lockfile unchanged |
| `bun run type-check:ui` | pass |
| `bun run type-check:web` | pass |
| `bun run build` | pass (web + desktop asset staging; needs `packages/mobile/scripts/prepare-web-assets.mjs` in this snapshot) |
| `cargo check` (src-tauri) | pass, 1 warning (`sidecar::shared` unused) |
| `bun run --cwd packages/desktop test` | 4 pass |
| `vitest run server/lib/session-recovery/` (packages/web) | 15 pass |
| `bun run desktop:build:unsigned` | pass, `Spleen_0.1.0_x64-setup.exe` (155.1 MiB), no updater artifact |
| `bun run brand:audit` | pass, `8843 tracked files clean` |

## Shell tests (upstream baseline)

`bun run test` exits 1 on the source snapshot before Spleen changes; the log is
`spleen-references\baseline-test.log`. Observed failures include brand staleness
(`openChamberLogoArt.ts`), verify/stand checks and perf browser tests with
`test could not be started because its parent finished`. These are not caused by
Spleen and remain visible until addressed.

## Runtime

| Probe | Observation |
|---|---|
| `opencode.exe --version` (staged) | `2.3.0` |
| `GET /health` | `200`, `status: ok`, `runtime: desktop`, `openCodeRunning: true`, `opencodeBinarySource: bundled`, `opencodeApiPrefixDetected: true` |
| Window | title `Spleen`, responding; UI rendered the real session list against the bundled backend |
| Sidecar binary | 120.4 MiB, compiled with Bun 1.4.4 |
| Killed `spleen.exe` | sidecar and managed OpenCode child gone (check with `Get-Process`) |
| Real turn | session created with `opencode/big-pickle`, assistant `pong`, `finish: stop` |
| Ledger after turn | `execution.started` → `execution.completed` in `%APPDATA%\Spleen\recovery.sqlite3` |

## Chat rendering (reasoning traces)

| Probe | Observation |
|---|---|
| Transcript from the bundled backend | `deepseek-v4.1-flash-free` assistant message carried `content: [{ type: "reasoning", text: ... }, { type: "text", ... }]` with `tokens.reasoning: 169` |
| Web UI in the Tauri-hosted sidecar | Live turn rendered a `Thinking` block above the answer, folded to a one-line summary while collapsed |
| Expand | Clicking the header set `aria-expanded="true"` and showed the full trace text |
| Server default | `formatSettingsResponse({}).showReasoningTraces === true` (`settings-helpers.test.js`), matching the UI store; previously the server returned `false` and hid every thinking block |
| Live events | `session.reasoning.started/delta/ended` map to a `reasoning` part and append deltas (`events.test.ts`) |

## Recovery
| Scenario | Observation |
|---|---|
| Ten crashed chats + children (test) | exactly 10 resume prompts, children `waiting_parent`, second pass sends none |
| 429 on resume (test) | `waiting_provider`, attempts kept, next wake in the future |
| Two coordinators (test) | only the lease owner reconciles |
| Resume attempt accounting (test) | attempt count survives the resumed execution start; a real new turn resets it |
| Real crash mid-tool | force-kill during a running `sleep`; after restart `resume.sent` → resumed execution `completed`; no duplicate turn |
| Stale outcome regression | a session whose previous turn succeeded but whose current turn is unfinished is resumed, not closed (transcript is authoritative) |

## Not verified

- NSIS install, upgrade from a previous signed build, uninstall, UAC, WebView2 absence.
- Code signing and updater signature verification (no certificate or keypair).
- Windows 11, 125/150/200% DPI, high-contrast and screen-reader passes.
- Remote pairing, relay, browser panel, SSH, terminal parity in the Tauri host.
- Performance comparison against the original Electron build.
