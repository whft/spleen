# Spleen Obsidian UI Rebrand & v1.0.0 — Testing & Verification Report

## 1. Automated Verification Summary

| Suite / Check | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Brand Artifact Check** | `bun run brand:generate --check` | **PASS** | `brand outputs match (15 text files)` |
| **Brand Upstream Audit** | `bun run brand:audit` | **PASS** | `brand-audit: 8913 tracked files clean` |
| **Changelog Integrity** | `node scripts/changelog/build.mjs --check` | **PASS** | `Changelog outputs are up to date.` (`changelog/1.0.0.md` -> `changelog/index.json`) |
| **UI TypeScript Check** | `bun run type-check:ui` | **PASS** | `0 type errors in 4,324 files across 2 projects` |
| **Web/Server TypeScript Check** | `bun run type-check:web` | **PASS** | `0 type errors in 2,913 files across 2 projects` |
| **Rust / Tauri Check** | `cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml --locked` | **PASS** | `Finished dev profile in 5.77s` (0 errors) |
| **Desktop Packaging Contract** | `bun run --cwd packages/desktop test` | **PASS** | `5 pass, 0 fail` (resources, NSIS identity, monochrome `#08090A`/`#F1F2EF`/`#959D9C` icon mark, `whft/spleen` updater feed, OpenCode pin) |
| **UI, Theme, Brand & i18n Unit Tests** | `bun test` (10 suites) | **PASS** | `56 pass, 0 fail` (`9,406 expect()` calls across `generate.test.mjs`, `fontOptions.test.ts`, `designSystem.surfaces.test.ts`, `button.test.tsx`, `dropdown-menu.test.tsx`, `SpleenLogo.test.tsx`, `messages.test.ts` across all 15 locales, `definition.test.ts` including WCAG 4.5:1 contrast invariant, `readableColors.test.ts`, `DraftTargetSelectors.test.tsx`) |
| **Server Vitest Suites** | `bun run --cwd packages/web vitest run ...` | **PASS** | `13 test files passed, 231 tests passed (0 failed)` (`session-recovery` 34, `limit-failover` 27, `teams` 5, `agent-tool/runtime.test.js` 100, `discord` 3, `unknowncheats` 4, `package-manager.test.js` 43, `changelog/update-notes.test.js` 15) |
| **Monochrome Token Sweep** | `rg` audit on `packages/ui/src/components` | **PASS** | `0` occurrences of legacy `#D9503F`, `#C2463A`, `#5865F2`, `#7289da`, `#83A7DC`, `#0B0F14`, `#121821`, `#1A222D`, `sky-*`, or `blue-*` |

## 2. Visual & Performance Verification Notes
- **Baseline ("BEFORE") Screenshots**: Captured and inspected in `docs/ui-rebrand/screenshots/before-{welcome,menu,settings,appearance,about,chat,final}.png`.
- **Theme Contrast & Readability**: Verified programmatically via `packages/ui/src/lib/theme/definition.test.ts` (`built-in text contrast > keeps every text role at 4.5:1 or more on its surfaces`) and `packages/ui/src/styles/designSystem.surfaces.test.ts`.
- **3D Monolith Performance Architecture**:
  - `SpleenMonolith3D.tsx` lazy-loads `SpleenMonolith3DScene.tsx` (`three@0.187.0`) via `React.lazy()` so zero WebGL or Three.js code executes in active chat or terminal views unless Welcome or About is rendered.
  - Uses `IntersectionObserver` (`threshold: 0.05`) and `document.addEventListener('visibilitychange')` to cancel `requestAnimationFrame` immediately when hidden or off-screen.
  - Respects `prefers-reduced-motion: reduce` and `webglcontextlost` by falling back to static `<SpleenLogo />` without allocating or spinning a WebGL context.
- **Note on External Tooling & Subagent Quota**:
  - Spline MCP was not configured in active MCP servers; `motion-ai` CLI installer was skipped to avoid mutating global MCP config; the automated `browser` subagent (`Model: "flash"`) hit a model quota limit (`RESOURCE_EXHAUSTED 429`) when invoked for the post-rebrand browser subagent pass, and the user directed proceeding directly with the production build and GitHub release.
