# Spleen Studio Redesign & Brand Audit

## 1. Local Reference Inventory (`krea-ui` Pack)
Read-only reference materials inspected before modifying source:
- Design handoff docs: `C:\Users\Admin\Downloads\krea-ui\00_START_HERE.md` through `13_SCREEN_BY_SCREEN_POLISH_CONTRACT.md` (including `11_PASTE_THIS_FIRST.md`).
- Extracted Krea design kit: `C:\Users\Admin\Downloads\krea-ui\krea-complete\{DESIGN.md,tokens.css,tokens.json}` and real product captures (`krea-product-home.jpg`, `krea-product-agent.jpg`, `krea-product-image.jpg`, `krea-product-settings.jpg`, `krea-model-picker.jpg`, `krea-home-light.jpg`, `krea-settings-light.jpg`).
- Extracted principles applied to Spleen without cloning Krea branding or marketing layout:
  1. High-clarity neutral separation: obsidian sidebar/rail (`#060607`), calm graphite studio canvas (`#101012`), raised composer/cards (`#1A1A1E`), crisp active pills (`#26262B`), and daylight gallery light mode (`#FFFFFF` canvas / `#F6F6F7` sidebar).
  2. Sculpted rounded surfaces: `22px` composer pill (`--radius-composer`), `16px` docked panels and command sheet, `10px` navigation pills, and `rounded-full` primary CTAs and filter chips.
  3. Calm monochrome hierarchy with high-contrast alabaster (`#FAFAFA` / `#09090B`) primary actions, muted disabled states, and surgical live status indicators (`var(--status-success)`).

## 2. Live Tool & Web Capability Probe
- `search_web`: verified accessible (confirmed Krea March 2026 redesign references).
- `browser` subagent: verified live navigation to `https://www.krea.ai/blog/redesign` and local isolated Spleen HMR app (`http://localhost:5185/` backed by real Spleen OpenCode CLI).
- `image-generator` subagent: verified accessible for original brand concept exploration (zero paid resources used).

## 3. Original App Icon Exploration & Selection
Three original icon directions were explored before vector production:
1. **Keystone Fold S (Selected)**: 180-degree symmetric sculpted S-ribbon with parallel diagonal cuts framing a brushed-titanium (`#90969E`) diamond keystone inside pure alabaster (`#FAFAFA`) arches on an obsidian (`#09090B`) squircle tile. Chosen for silhouette clarity down to 16x16 taskbar/tray sizes and instant legibility in both dark and light tiles.
2. **Interlocking S-Portal**: Continuous wrapped ribbon loop; softer silhouette at 16px.
3. **Faceted Monolith S**: Sharp architectural bevel folds; busier internal edge count at small favicon sizes.

All 13 canonical vector masters under `docs/brand/source/` and `docs/brand/tokens.json` (v2.0.0) were updated and compiled through `bun run brand:generate` and `bun run icons:generate` to regenerate all 56 platform icon assets and 15 text targets.

## 4. Functional Bugs Resolved Alongside the Redesign
- **OpenCode Zen "Free usage limit reached" Auto-Continue**: `packages/web/server/lib/session-recovery/{reconciler.js,runtime.js,store.js}` now recognizes OpenCode Zen free-limit stops (`provider.free-limit` / `opencode` / `opencode-zen`) even when the provider returns a 21-hour `retryAfterMs` header, arms a precise one-shot wake timer for immediate continuation (`3s`, then progressive backoff only on repeated failures), and resets the wait counter after resumed tool execution makes progress.
- **Composer Status Bar Overlap**: Moved `<RecoveryStatusBanner />` out of the absolute-covered sibling slot in `ChatContainer.tsx` into `useComposerRows.tsx` (`composerTopRows`) and `ComposerSlot.tsx` (`ReadOnlyComposer`) so waiting/recovery banners always dock cleanly above the typing editor without peeking underneath.

## 5. Surfaces Redesigned & Verified
- Core themes & design tokens: `spleen-dark.json`, `spleen-light.json`, `design-system.css`
- Shell, welcome, composer, & command palette: `useComposerPreferences.ts`, `useComposerControls.ts`, `renderComposerForm.tsx`, `DraftPresetChips.tsx`, `ContextPanelRail.tsx`, `ContextPanel.tsx`, `WorkStatusPanel.tsx`, `command.tsx`, `CommandPalette.tsx`, `SettingsView.tsx`, `sortableItems.tsx`
- Integrated panels (Dark + Light token parity & header deduplication): `TeamsPanel.tsx`, `TeamLauncher.tsx`, `TeamExecutionGraph.tsx`, `DiscordConnectForm.tsx`, `DiscordPanel.tsx`, `DiscordChannels.tsx`, `DiscordAvatar.tsx`, `DiscordDirect.tsx`, `DiscordMarkdown.tsx`, `UnknownCheatsPanel.tsx`
