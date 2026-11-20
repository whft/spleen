# Spleen Obsidian UI Rebrand & Functional Overhaul — Implementation Log

## 1. Pre-Rebrand Functional Overhaul (Checkpoint `2cbb4fd`)
- **Copy & Status Polish**:
  - Updated `packages/ui/src/components/chat/composer/status/WorkStatusPrimaryGroup.tsx`, `WorkStatusUsageSection.tsx`, `useDraftHeading.ts`, and `useAgentStatusLabel.ts` to eliminate awkward `"Session"` / `"Usage   Used"` / AI-slop phrasing.
- **Usage-Limit Failover & Session Recovery**:
  - Implemented `packages/web/server/lib/limit-failover/*` and `packages/web/server/lib/session-recovery/*` (stall watchdog, exponential backoff auto-continue, provider/model limit parking & failover) and `/api/recovery/*` routes.
  - Added `packages/ui/src/stores/useRecoveryStore.ts`, `packages/ui/src/hooks/useRecoverySync.ts`, and `packages/ui/src/components/chat/RecoveryStatusBanner.tsx` with 15-locale translations.
- **AI Teams & DAG Orchestrator + Full In-App AI Control**:
  - Implemented `packages/web/server/lib/teams/*` (DAG execution engine, presets for Feature Builder, Bug Hunter, Security Auditor, UI Polisher) and `packages/ui/src/components/teams/{TeamsPanel,TeamLauncher}.tsx`.
  - Implemented `packages/web/server/lib/spleen-control/*` and extended `packages/web/server/lib/agent-tool/runtime.js` + `packages/ui/src/hooks/useAgentUiControlSync.ts` so Spleen AI can inspect and control settings, UI surfaces, session recovery, AI Teams, Discord, and UnknownCheats.
- **Integrated Discord Reader & Live Client**:
  - Implemented `packages/web/server/lib/discord/{store,client,gateway,routes}.js` (DPAPI-backed Windows token storage, REST + Gateway WebSocket client, SSE event stream) and `packages/ui/src/components/discord/{DiscordPanel,DiscordConnectForm,DiscordMarkdown,DiscordEmbed,DiscordMembers,DiscordAvatar}.tsx` + `DiscordIntegrationCard.tsx`.
- **Integrated UnknownCheats Reader & Tauri Verification Bridge**:
  - Implemented `packages/web/server/lib/unknowncheats/{store,parser,client,routes}.js` and wired into `packages/web/server/index.js`.
  - Added Tauri v2 verification window & non-blocking cookie reader (`desktop_uc_open_window`, `desktop_uc_read_cookies` wrapped in `tokio::task::spawn_blocking`, and `desktop_open_browser_window`) in `packages/desktop/src-tauri/src/bridge.rs` and `packages/ui/src/lib/desktop.ts`.
  - Registered `'unknowncheats'` surface mode in `packages/ui/src/lib/surfaces/{modes,registry}.ts`, added 15-locale translations (`unknowncheats.i18n.ts`), and built `packages/ui/src/components/unknowncheats/UnknownCheatsPanel.tsx` + `packages/ui/src/lib/unknowncheats/api.ts`.

## 2. Obsidian Dark Monochrome Design System (Stages C & D)
- **Self-Hosted Offline Typography**:
  - Installed `@fontsource-variable/geist@5.3.0` and `@fontsource-variable/geist-mono@5.3.0` in `packages/ui`.
  - Loaded variable font stylesheets in `packages/ui/src/styles/fonts.ts` and set `DEFAULT_UI_FONT = 'geist-sans'` and `DEFAULT_MONO_FONT = 'geist-mono'` in `packages/ui/src/lib/fontOptions.ts`.
- **Obsidian Monochrome Brand Mark & Icon Pipeline**:
  - Updated `docs/brand/source/*.svg`, `docs/brand/tokens.json`, `scripts/brand/{geometry,generate}.mjs`, `packages/web/{index,mini-chat}.html`, and `packages/desktop/test/build-contract.test.mjs` to `#08090A` obsidian tile, `#282D30` border stroke, `#F1F2EF` platinum outer blades, and `#959D9C` brushed titanium center blade.
  - Regenerated all 15 brand text artifacts, 56 brand images, and 348 icon assets (`bun run brand:generate`, `bun run icons:generate`).
- **Obsidian Surface Hierarchy & Zero-Red / Zero-Blue Sweep**:
  - Updated `packages/ui/src/lib/theme/themes/{spleen-dark,spleen-light}.json` and `packages/ui/src/styles/design-system.css`:
    - Canvas `#08090A`, deep workspace `#0B0D0F`, surface `#111416`, elevated `#171B1D`, popover/menu `#0C0E10` at 98% opacity, border `#282D30`, primary `#E5E8E3` with `#08090A` ink, secondary `#959D9C`, surgical micro-accent `#C8FA62` / `#829E4B`.
  - Updated UI primitives (`dropdown-menu.styles.ts`, `dialog.tsx`, `command.tsx`, `select.tsx`, `tooltip.tsx`, `button-variants.ts`, `DraftTargetSelectors.tsx`) and feature surfaces (`Discord*`, `TeamsPanel.tsx`, `RecoveryStatusBanner.tsx`, `UnknownCheatsPanel.tsx`) to eliminate all legacy vermilion red (`#D9503F`) and blurple/sky/blue (`#5865F2`, `#83A7DC`, `sky-*`, `blue-*`).

## 3. Sculptural 3D Obsidian Identity (Stage F)
- Created `packages/ui/src/components/ui/SpleenMonolith3DScene.tsx` and lazy wrapper `packages/ui/src/components/ui/SpleenMonolith3D.tsx` using raw `three@0.187.0`:
  - Extrudes the 3-blade `SPLEEN_LOGO_ART` geometry with chamfered bevels, offline `PMREMGenerator` + `RoomEnvironment` metallic reflections, dark anodized obsidian outer blades (`#24292D`), brushed titanium core (`#B4BCBA`), platinum key light, cool slate fill, and grazing `#C8FA62` rim glint.
  - Includes damped pointer parallax, `IntersectionObserver` + `document.visibilitychange` auto-pause, `prefers-reduced-motion` and `webglcontextlost` static `<SpleenLogo />` fallback, and full GPU resource `.dispose()` on unmount.
- Mounted `<SpleenMonolith3D />` on the desktop Welcome view (`renderComposerForm.tsx`), compact Welcome view (`DraftWelcome.tsx`), and About views (`AboutLogo.tsx`), and restyled `packages/desktop/splash/index.html` to pure Obsidian monochrome with CSS-3D monolith float.

## 4. Desktop Parity, Versioning & GitHub Release Wiring (Stage G)
- Fixed `BrowserPane.tsx` `isChromiumHost()` detection for Tauri WebView2 and added native window popout in `BrowserToolbar.tsx`.
- Aligned all workspace and Tauri manifests (`package.json`, `packages/{web,ui,desktop}/package.json`, `tauri.conf.json`, `Cargo.toml`) to version `1.0.0`, added `changelog/1.0.0.md`, generated `changelog/index.json`, pointed `package-manager.js` and `update-notes.js` to `whft/spleen`, and configured external Tauri updater signing keys (`%USERPROFILE%\.spleen-signing\`) + GitHub Actions secrets.
