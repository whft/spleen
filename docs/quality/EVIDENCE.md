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
| `vitest run server/lib/session-recovery/` (packages/web) | 33 pass: crash matrices, limit parking and continuation, parent links, lease |
| `bun run desktop:build:unsigned` | pass, `Spleen_0.1.0_x64-setup.exe` (155.19 MiB, 162,730,828 bytes, SHA-256 `7BCD4C49D5166034614157BEB18B7381FCBD8C5469172EC5E99725C559CAA714`), no updater artifact; its sidecar embeds `rust_pty.dll` and the usage-limit recovery |
| `bun run brand:generate` | pass, 15 text files and 56 images rebuilt from `docs/brand/source` |
| `bun run brand:generate --check` | pass, every text output current |
| `bun run brand:audit` | pass, `8826 tracked files clean` |
| `bun test scripts/brand/generate.test.mjs packages/ui/src/components/ui/SpleenLogo.test.tsx` | 11 pass: master path and accent node match the kit, the rendered app icon keeps the tile and node, the sprite glyph follows the master, tray has no tile or dot, `.ico` directory sizes correct |
| `bun run --cwd packages/desktop test` | 5 pass, including the bundled icon set and NSIS installer icons |
| `bun test` theme suite (definition, storage, readable colors, `SpleenLogo`) | 48 pass |
| `bun test packages/web/server/lib/session-knowledge/runtime.test.js` | 51 pass, including `spleen.base` in every session and a response style that cannot replace it |
| `vitest run server/lib/opencode/managed-config-file.test.js server/lib/opencode/managed-plugin-config.test.js` (selected) | 5 pass: the managed config names the base-rules file, the file holds the exact text, the fallback keeps the user's files and appends ours once |
| `bun test packages/vscode/src/plugin-switches.test.ts -t "managed OpenCode layer"` | 6 pass: the extension's managed config names the same base-rules file, writes its text, and merges it into `OPENCODE_CONFIG_CONTENT` when the user owns the config |
| `vitest run server/lib/terminal/runtime.test.js` (packages/web) | 51 pass; the shell-list case still fails on Windows path expectations, present before this change |
| compiled `spleen-server.exe serve` + `POST /api/terminal/create` | 200, `{"status":"running"}`, so the sidecar loads bun-pty from its embedded `rust_pty.dll` |
| dev server on `127.0.0.1:58233` with an isolated data dir and `OPENCODE_CONFIG` cleared | `opencode.managed.json` names `<instance>/core-instructions.md`; the file is 2100 chars, starts `Spleen house rules`, carries no persona or greeting, and managed OpenCode launched on its allocated port |
| `bun run check:changed -- --ratchet-only` | pass: no new findings, no source file over 800 lines grew |
| `bun run check:changed` | pass: lint, dead code, ratchet and file-size gates all green |

The root `tsconfig.json` no longer names the removed `packages/electron`
project, and the three exports knip reported (`openRecoveryDatabase`,
`toolPartsOf`, `hasDesktopRuntime`) are now private. The full gate passes; knip
still prints four configuration hints, none of which fail.

## Brand identity

| Probe | Observation |
|---|---|
| Icon in `target/release/spleen.exe` (`ExtractAssociatedIcon`) | bone S on the near-black rounded tile with the vermilion node |
| Taskbar while the release app ran | the same Spleen tile, distinct from the bundled OpenCode CLI icon beside it |
| `Spleen_0.1.0_x64-setup.exe` icon | the Spleen tile; the generated `installer.nsi` sets `MUI_ICON` and the header/sidebar bitmaps |
| Installer artwork | `installer-header.bmp` 150x57 and `installer-sidebar.bmp` 164x314 render the mark, wordmark and caption |
| Splash at 420x260 | kit mark, bone wordmark and vermilion progress bar on `#0B0F14` |
| Default themes | `spleen-dark` and `spleen-light` resolve and are selected in Appearance; both round-trip through `requireTheme(compactTheme(...))` |
| App screenshots | `docs/references/desktop_dark.png` and `desktop_light.png`, 1440x900, captured from the running server |
| Settings → About | kit mark, `Spleen`, and a single GitHub link to `whft/spleen`; the inherited Discord and X links are gone |

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
| Usage-limit execution failure (test) | `waiting_provider` at `retryAfterMs` (120s), state not `failed`, attempts kept |
| Usage reset reached (test) | the completed-but-failed turn is resumed with the usage-limit prompt, crash attempt unchanged |
| Future reset in the transcript (test) | a due `waiting_provider` row waits for the reset the error names instead of resuming early |
| Short reset after a continuation (test) | a repeated 5-minute hint cannot wake the chat before the 1-hour backoff |
| 429 on the continuation POST (test) | counted as a provider wait and parked at the 1-hour backoff |
| Free limit naming 10.9 hours (test) | parked at a 5-minute probe, then at the named reset |
| Accepted continuation not yet in the transcript (test) | waited for from its send time, then review after 10 minutes |
| Crash budget spent (test) | a due limit row still resumes at `attempts: 2` |
| Quota with no reset (test) | parks 1h after the failure, then 2h on the next pass |
| Rate limit that outlived OpenCode retries (test) | 8s hint is not trusted after the turn failed; parks 1h |
| Chat failed by an earlier build (test) | a `failed` row with `provider.quota` is parked and resumed at startup |
| Subagent link (test) | `parentID` from session info is stored; the child waits while the parent is pending |
| Running child of a parked parent (test) | attached as `running`, not deferred to `waiting_parent` |
| Two coordinators (test) | only the lease owner reconciles |
| Resume attempt accounting (test) | attempt count survives the resumed execution start; a real new turn resets it |
| Real crash mid-tool | force-kill during a running `sleep`; after restart `resume.sent` → resumed execution `completed`; no duplicate turn |
| Stale outcome regression | a session whose previous turn succeeded but whose current turn is unfinished is resumed, not closed (transcript is authoritative) |

## Not verified

- A real provider usage limit and its reset: no account was deliberately
  exhausted. The paths use OpenCode 2.3.0's exact `SessionError` shape
  (`provider.*`, `retryAfterMs`, `response.body`, `model.providerID`) in unit
  tests.
- Clean-machine Windows 11 install, uninstall, and SmartScreen verification
  without dev tools installed.
- Authenticode Windows code signing (no certificate configured yet; Tauri
  updater signature `.sig` is verified).
- Windows 11 125/150/200% DPI, high-contrast and screen-reader passes.
- The tray glyph on a light Windows theme.
- Full `spleen_web` agent DOM/screenshot automation on Tauri desktop (awaits
  Playwright/CDP browser provider extension).
- Live third-party Discord / UnknownCheats authenticated account scraping
  (unit-tested with mock HTTP/Gateway fixtures; live verification depends on
  user account credentials).

## 2026-11-22 Audit, Zen Recovery, Teams Hardening & Tauri Parity Run

| Command | Result |
|---|---|
| `bun run type-check:ui` | pass, 0 errors across 4,323 files |
| `bun run type-check:web` | pass, 0 errors across 2,912 files |
| `cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml` | pass, 0 errors, 1 pre-existing warning (`sidecar::shared` unused) |
| `bun run --cwd packages/desktop test` | pass, 5/5 tests |
| `bun run brand:audit` | pass, 8,939 tracked files clean |
| `bun run --cwd packages/web test server/lib/session-recovery/ server/lib/limit-failover/` | pass, 63/63 tests (36 recovery + 27 limit-failover, including OpenCode Zen chat/subagent auto-continue, running-parent non-deadlock, stopped-session discovery, and non-Zen exclusion) |
| `bun run --cwd packages/web test server/lib/teams/` | pass, 7/7 tests (DAG validation, blocked-dependency propagation, `@lead` escalation, cancel abort, retry unblock) |
| `bun run --cwd packages/web test server/lib/discord/ server/lib/unknowncheats/` | pass, 7/7 tests |
| `bun run --cwd packages/web test server/lib/session-goal/` | pass (all tests in `audit.test.js`, `create.test.js`, `runtime.test.js`) |
| `bun run --cwd packages/web test server/lib/spleen-control/` | 17 pre-existing Windows-only failures in untouched upstream tests (`chats.test.js`, `file-open.test.js`, `project-knowledge.test.js`, `service.test.js`) due to POSIX `/repo` vs `C:\repo` path expectations and unprivileged `fs.symlink` `EPERM`; all other tests passed |
| `bun run build:web` | pass in 3m 5s (`vendor-three` removed from bundle after deleting unused 3D clutter) |
| `bun run --cwd packages/desktop build && bun run --cwd packages/desktop tauri:build` | pass, `Spleen_1.1.0_x64-setup.exe` (155.54 MiB) + `.sig` built |
| `Spleen_1.1.0_x64-setup.exe /S` + detached launch + `GET http://127.0.0.1:3721/health` | exit 0, `LIVE_LISTENING=0.0.0.0:3721`, `spleenVersion: "1.1.0"`, `openCodeRunning: true`, `status: "ok"` |

## 2026-11-23 Spleen Studio Redesign, Keystone Fold S Identity & Zen Auto-Continue Run

| Command / Probe | Result |
|---|---|
| `bun run brand:generate` | pass, rebuilt 15 text outputs and 56 platform icon/installer images from v2.0 Keystone Fold S vector masters |
| `bun run brand:generate --check` & `bun run brand:audit` | pass, 15 text files match and `8939 tracked files clean` |
| `bun run icons:generate` | pass, generated 350 icons in `packages/ui/src/components/icon/sprite.ts` |
| `bun test scripts/brand/generate.test.mjs packages/ui/src/components/ui/SpleenLogo.test.tsx` | pass, 11/11 tests |
| `bun test packages/ui/src/components/chat/lib/visualKit.test.ts packages/ui/src/lib/theme/vscode/adapt.test.ts` | pass, 13/13 tests |
| `bun run type-check:ui` & `bun run type-check:web` | pass, 0 errors across 4,323 UI files and 2,912 web files |
| `bun run --filter '*' lint` | pass, 0 errors across all 6 workspace packages |
| `bun run --cwd packages/web test server/lib/session-recovery/ server/lib/limit-failover/ server/lib/teams/ server/lib/discord/ server/lib/unknowncheats/` | pass, 10/10 files, 78/78 tests |
| `bun run --cwd packages/desktop test` | pass, 5/5 tests |
| `cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml` | pass, 0 errors |
| Browser visual QA on `http://localhost:5185/` | verified Dark (`1440x900` and `1024x768`) and Light (`1440x900`) screenshots across Welcome, Composer, Work Status, AI Teams, Discord, UnknownCheats, Command Palette, and Settings Appearance |
| `bun run build:web && bun run --cwd packages/desktop build && bun run --cwd packages/desktop tauri:build` | pass, `Spleen_1.1.0_x64-setup.exe` (155.57 MiB) + `.sig` built |
| `Spleen_1.1.0_x64-setup.exe /S` + launch `C:\Users\Admin\AppData\Local\Spleen\spleen.exe` + `GET http://127.0.0.1:3721/health` | exit 0, `status: "ok"`, `runtime: "desktop"`, `openCodeRunning: true`, `isOpenCodeReady: true`, `opencodeBinarySource: "bundled"` |
| Version bump to `1.2.0` (`package.json`, `desktop`, `ui`, `web`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `bun.lock`) + `package-manager.js` compiled `getCurrentVersion()` fallback | pass: `bun install --frozen-lockfile --ignore-scripts`, `cargo check --locked`, `43/43` `package-manager.test.js`, `24/24` brand/theme tests, `5/5` desktop contract tests |
| Signed `1.2.0` desktop build (`tauri:build`) | pass, `Spleen_1.2.0_x64-setup.exe` (155.57 MiB) + `Spleen_1.2.0_x64-setup.exe.sig` (`version:1.2.0`, matching `tauri.conf.json` pubkey) |
