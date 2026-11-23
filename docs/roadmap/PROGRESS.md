# Spleen progress ledger

Evidence-only status. Every "done" line names the command or observation that
proved it. Dates are local (Windows, UTC-5).

## Snapshot

- Product tree: `C:\Users\Admin\Documents\Spleen`, no git history of its own
  yet, created from a `git archive` snapshot of OpenChamber
  `9443e94c613578c3f0eca4c171d9af4cbd8df514` (v2.7.2-281, MIT).
- References and dev-only transformers live outside the product repo in
  `C:\Users\Admin\Documents\spleen-references\`.
- Toolchain: Windows 10.0.19045, git 2.55.0, Node 24.22.3, Bun 1.4.4,
  rustc/cargo 1.98.1, gh 2.98.0 authenticated as `whft`.

## Done

### Source audit and baseline (2026-11-17)

- Baseline on the unmodified snapshot: `bun install` OK, `type-check:ui` OK,
  `bun run build` OK (root build needed `packages/mobile/scripts/prepare-web-assets.mjs`
  and then exited 0). `bun run test` exits 1; full log in
  `spleen-references\baseline-test.log` (brand staleness, verify/stand checks,
  perf browser tests fail with `test could not be started because its parent
  finished`). These failures predate Spleen.
- Snapshot identity: OpenChamber v2.7.2-281, MIT license retained in `LICENSE`.

### Rebrand (2026-11-17)

- 2,840 files changed, 42 paths renamed by `rebrand.mjs`; a second pass fixed a
  NUL-byte skip in `delta-coalescer.js`.
- `packages/electron`, `.openchamber`, `.claude` and the inherited changelog
  removed; root scripts now speak to `packages/desktop`.
- `bun install`, `type-check:ui`, `type-check:web` pass, `bun run build` exits 0.
- Brand assets: `scripts/brand` now reads the approved identity kit vectors in
  `docs/brand/source` and writes 15 text and 56 image files (favicon, PWA, Tauri
  icons, NSIS header/sidebar, tray, `.ico`, mobile launcher and splash).
  `SpleenLogo.tsx` renders the kit path and terminal node; the default
  `spleen-dark`/`spleen-light` themes use the kit palette.
- Remaining brand gaps fixed on 2026-11-18: `site.webmanifest` name/colors,
  iOS widget scheme, iOS privacy comments, the ghostty PTY symbol, README
  badges/links.

### Tauri host (2026-11-17 .. 2026-11-18)

- `packages/desktop/src-tauri`: Tauri 2.12 host, single instance, tray,
  frameless window, job-object child cleanup, graceful stop.
- OpenCode CLI 2.3.0 pinned and staged at
  `src-tauri/resources/opencode-cli/opencode.exe` (`opencode.exe --version` →
  `2.3.0`).
- Backend sidecar: `bun build --compile` → 120.4 MiB `spleen-server.exe`;
  spawned with a random loopback port and one-launch password, then bearer
  client token.
- `cargo check` exits 0 (one dead-code warning for `sidecar::shared`).
- First working launch: window titled `Spleen`, health `200` with
  `openCodeRunning: true`, `opencodeBinarySource: "bundled"`, and the real
  session list rendered (screenshot taken).
- Force-killing `spleen.exe` removed both the sidecar and the managed OpenCode
  child (job object verified).

### Backend compatibility fixes (2026-11-18)

Found only by running the compiled sidecar, each fixed at the cause:

- `settings-registry.json` was loaded through `createRequire`; compiled Bun
  cannot resolve it. Now a static JSON import (`settings-files.js`,
  `settings-helpers.js`).
- `gatekeeper-program.cjs` was read from a source-relative URL; now embedded
  with `with { type: 'text' }`.
- `authoring/skill.txt` had the same problem; now embedded as text.
- The CLI entry check compared `process.argv[1]` with `__filename`, which never
  matches in a compiled binary. It now also accepts `Bun.main`
  (`cli-entry-runtime.js`, test added).
- `SPLEEN_VERSION` read `package.json` through a source path; now a static
  import.
- Built-in extensions root: added `SPLEEN_BUILTIN_EXTENSIONS_DIR`, staged
  `packages/web/server/built-in-extensions` into Tauri resources, and passed it
  from Rust.

### Real backend proof (2026-11-18)

- Created a session through the app's own orchestration route with the bundled
  OpenCode and model `opencode/big-pickle` (free), prompt "Reply with the single
  word: pong". Transcript: assistant `pong`, `finish: stop`.
- Ledger recorded `execution.started` → `execution.completed` for that turn:
  `recovery.sqlite3`, session `ses_e12c4c106ffeJAreAVLdO5IwUI`.

### Chat reasoning traces (2026-11-18)

- Reasoning is rendered as a `Thinking` block above the answer, folded to a
  one-line summary, expandable to the whole trace, with `Thinking…` while the
  model is still reasoning. Proven in the running app with
  `deepseek-v4.1-flash-free`: the transcript carried a `reasoning` content part
  (`tokens.reasoning: 169`) and the UI showed the block; expanding it revealed
  the full trace (`docs/quality/EVIDENCE.md`).
- Cause of thinking blocks being invisible by default: the server's
  `formatSettingsResponse` defaulted `showReasoningTraces` to `false` while the
  UI store defaulted to `true`, so every client received `false`. The server
  default is now `true`; an explicit user choice of `false` is still honored
  (`settings-helpers.test.js`).
- Live streaming of reasoning (`session.reasoning.started/delta/ended`) is
  covered by `packages/ui/src/lib/opencode/events.test.ts`.

### Packaging (2026-11-18)

- `bun run desktop:build:unsigned` builds the NSIS installer without updater
  signing; plain `desktop:build` needs `TAURI_SIGNING_PRIVATE_KEY` because the
  bundle produces `v1Compatible` updater artifacts.
- Unsigned build verified end to end on 2026-11-18: `Finished 1 bundle`,
  `Spleen_0.1.0_x64-setup.exe` (155.1 MiB), exit 0, no `.nsis.zip` emitted.
- An earlier `desktop:build` ran the full pipeline including the signed updater
  artifact and failed only at the signing step because the private key is absent.

### Durable recovery (2026-11-18)

- New module `packages/web/server/lib/session-recovery/`: SQLite WAL ledger,
  inline migrations, coordinator lease, raw-event intake, pure reconciler,
  resume prompt with idempotency metadata, provider-limit parking.
- Wired into `index.js` (startup, `GET /api/recovery/status`) and shutdown.
- Tests: `vitest run server/lib/session-recovery/` → 15 passed, including ten
  crashed chats with children resumed once each, quota parking, lease
  exclusivity, attempt accounting.
- Real crash run: turn with a running `sleep` tool, `spleen.exe` force-killed,
  app restarted. Ledger: `resume.sent` → new `execution.started` →
  `execution.completed`; no duplicate turn.
- Bug found by that run and fixed: `Session.Info.outcome` was treated as the
  current turn's outcome and closed an unfinished turn. The transcript is now
  authoritative and a unit test covers the stale-outcome case.

### Repository, docs and CI (2026-11-18)

- `git init -b main`, initial commit `f04e7a0` (8,864 tracked files), pushed to
  the private `whft/spleen` remote; generated artifacts, the pinned CLI cache
  and Playwright output are ignored.
- `.github/workflows/ci.yml` (brand gate, types, recovery + desktop contract
  tests), `windows-package.yml` (unsigned NSIS artifact) and `release.yml`
  (tag/version agreement, signing-secret guard, draft release). The inherited
  upstream workflows that depended on OpenChamber infrastructure were removed.
- Brand gate `scripts/brand/audit.mjs` with a two-entry allowlist for upstream
  attribution; `bun run brand:audit` reports the tracked tree clean.
- Internal docs: `docs/INDEX.md`, architecture, recovery, Windows dev, evidence
  and upstream pages, plus `packages/web/server/lib/session-recovery/DOCUMENTATION.md`.

## In progress

- Tauri Windows browser-automation provider (`browser-control/provider.js`) for full `spleen_web` agent DOM/screenshot parity without Electron's `<webview>`.
- Clean-machine install/upgrade/uninstall verification on a non-dev Windows 11 machine.

## Done (2026-11-20 .. 2026-11-22)

- **Signed releases & version alignment**: Aligned manifests across root, `packages/web`, `packages/ui`, `packages/desktop`, `tauri.conf.json`, and `Cargo.toml`; generated Tauri updater keypair outside the repo (`%USERPROFILE%\.spleen-signing\`); published signed public GitHub Releases (`v1.0.0`, `v1.1.0`) on `whft/spleen` with verified `latest.json`.
- **Tauri bridge parity**: Implemented multi-window (`desktop_new_window*`), mini-chat windows, native popout browser (`desktop_open_browser_window`), UnknownCheats verification bridge (`desktop_uc_*`), OpenSSH tunnel manager (`ssh.rs`, all 8 `desktop_ssh_*` commands), LAN binding (`0.0.0.0:3721`), remote host persistence fix + `desktop_host_probe` / `desktop_remote_password_login` / `desktop_switch_to_local`, and favicon fetching.
- **OpenCode Zen usage auto-continue**: Scoped automatic usage-limit `Continue.` to OpenCode Zen/Go (`opencode`, `opencode-zen`, `opencode-go`), eliminated the subagent `waiting_parent` deadlock while parents run, added stopped-session discovery, and verified 63/63 tests across `session-recovery` and `limit-failover`.
- **AI Teams & Project Agents**: Workspace picker, custom per-member agents/models, `.opencode/agents/*.md` CRUD + Recruit, functional `TeamExecutionGraph`, cancellation abort, transitive `blocked` dependency propagation, `@lead` escalation, and auto-unblock on retry (7/7 tests passing).
- **UI cleanup**: Removed decorative 3D rings, floor circles, wireframe slabs, and spinning constellation objects from Welcome, About, and Teams; updated stale Electron references in `AGENTS.md`, `CONTRIBUTING.md`, and `README.md`; recorded full audit in `docs/audit/PRODUCT_AUDIT_2026.md`.

## Blockers / owner actions

- No Windows Authenticode code-signing certificate yet; SmartScreen will warn on third-party machines until signed.
- The bundled OpenCode server and an already-installed OpenCode desktop can read
  the same user data store. Not yet evaluated for lock contention; treat as a
  product risk until measured.
