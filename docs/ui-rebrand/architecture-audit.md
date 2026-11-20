# Spleen — Architecture & UI Audit

- **Repository**: `C:\Users\Admin\Documents\Spleen`
- **Git Checkpoint Before UI Rebrand**: `2cbb4fd` (`chore: checkpoint recovery, teams, discord, and unknowncheats backend before obsidian ui rebrand`)
- **Runtime Manager**: Bun (`packageManager: bun@1.4.4`, Node engine `>=24.14.0` for Express sidecar tooling)

---

## 1. Repository & Package Structure

Monorepo (`workspaces: ["packages/*", "packages/sdk/examples/*"]`):

| Package | Role | Key Stack |
| --- | --- | --- |
| `packages/ui` (`@spleen/ui`) | Shared React frontend, styling system, themes, stores, i18n, surfaces | React `19.1.1`, TypeScript `~7.0.2`, Tailwind CSS `v4.0.0`, `@base-ui/react ^1.4.0`, `motion ^12.23.24`, `cmdk ^1.1.1`, `sonner ^2.0.7`, `zustand ^5.0.8`, `@remixicon/react`, `@pierre/diffs`, `codemirror` |
| `packages/web` (`@spleen/web`) | Vite web host + Express HTTP/WS/SSE server + OpenCode lifecycle & sidecar runtimes | Vite `7.3.2`, Express `5.1.0`, `ws ^8.18.3`, Vitest `4.1.4`, `vite-plugin-pwa ^2.0.0` |
| `packages/desktop` (`@spleen/desktop`) | Windows native Tauri 2 desktop host, splash screen, installer assets, Bun-compiled sidecar orchestrator | Tauri `2` (`tauri` Rust crate + `@tauri-apps/cli ^2.9.1`), NSIS Windows bundler, `tauri-plugin-updater`, `tauri-plugin-dialog`, `tauri-plugin-notification`, `tauri-plugin-opener`, `tauri-plugin-single-instance` |
| `packages/sdk` | OpenCode SDK workspace helpers | `@opencode/client 2.3.0`, `@opencode/schema 2.3.0` |
| `packages/vscode`, `packages/mobile`, `packages/docs` | Secondary targets sharing `@spleen/ui` and generated brand/icon assets | VS Code webview, Capacitor Android, Docs |

Desktop architecture is **Tauri 2 (Rust)** spawning a compiled Bun HTTP/WS/SSE sidecar (`binaries/spleen-server.exe`), serving bundled `web-dist/` + `opencode-cli/` + `built-in-extensions/` inside Windows WebView2 (NOT Electron).

---

## 2. Frontend Architecture, State, Routing & Styling

- **Entry points**:
  - `packages/web/src/main.tsx` -> loads `@spleen/ui/styles/katex-css` before `@spleen/ui/index.css` -> mounts `packages/ui/src/App.tsx`.
  - `packages/desktop/splash/index.html` -> instant-paint native splash shown while Rust starts the sidecar & OpenCode engine.
  - `packages/ui/src/index.css` -> imports `tailwindcss`, `tw-animate-css`, `./styles/design-system.css`, `./styles/typography.css`, `./styles/mobile.css`.
- **Theme engine**:
  - Built-in theme manifests in `packages/ui/src/lib/theme/themes/spleen-dark.json` and `spleen-light.json` (plus bundled presets), applied at runtime by `CSSVariableGenerator` (`packages/ui/src/lib/theme/cssGenerator.ts`) via `<style id="opencode-theme-variables">` overrides (`!important` CSS custom properties).
  - Crucial finding: `cssGenerator.ts` defaults omitted `primary.foreground` to `#ffffff`. Light/platinum-bone monochrome `primary.base` in dark mode requires explicit `"foreground": "#08090A"` in `spleen-dark.json` and `--primary-foreground: #08090A` in `design-system.css`.
- **Font system**:
  - `packages/ui/src/styles/fonts.ts` and `packages/ui/src/lib/fontOptions.ts`.
  - Prior defaults: `DEFAULT_UI_FONT = 'system'`, `DEFAULT_MONO_FONT = 'system-mono'`.
  - `UI_FONT_OPTIONS` / `CODE_FONT_OPTIONS` already include `'geist-sans'` and `'geist-mono'`, which can be bundled offline via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` JS imports in `styles/fonts.ts` (avoiding CSS `@import` which Lightning CSS inlines without copying font URLs).
- **UI Primitives**:
  - Built predominantly on `@base-ui/react` (`dialog.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `select.tsx`, `tooltip.tsx`) + `cmdk` (`command.tsx`, `CommandPalette.tsx`) + `sonner` + CVA (`button-variants.ts`) + `@remixicon/react` (`Icon.tsx`).
  - Surface & glass styles live centrally in `packages/ui/src/styles/design-system.css` and `dropdown-menu.styles.ts`.
  - Preserved invariant tests in `packages/ui/src/styles/designSystem.surfaces.test.ts` assert exact composer canvas rules (`html:not(.dark) .oc-composer-surface`) and single `linear-gradient` in `.oc-selected`.

---

## 3. Main UI Screens & Surfaces Mapped

| Screen / Surface | Primary File(s) |
| --- | --- |
| Main Shell / Titlebar / Chrome | `packages/ui/src/components/layout/{MainLayout,Header,Sidebar,SidebarTopBar,TitlebarLeftControls}.tsx` |
| Welcome / Empty Conversation | `packages/ui/src/components/chat/column/DraftWelcome.tsx`, `DraftPresetChips.tsx` |
| Active Chat, Markdown, Code, Composer | `packages/ui/src/components/views/ChatView.tsx`, `packages/ui/src/components/chat/{ChatContainer,RecoveryStatusBanner}.tsx`, `composer/` |
| Context Panels / Right Activity Rail | `packages/ui/src/components/layout/{ContextPanel,ContextPanelRail,ContextSurfacePanes,RightSidebarTabs}.tsx`, `packages/ui/src/lib/surfaces/{modes,registry}.ts` |
| AI Teams / DAG Orchestrator | `packages/ui/src/components/teams/{TeamsPanel,TeamLauncher}.tsx` |
| Discord Reader | `packages/ui/src/components/discord/{DiscordPanel,DiscordConnectForm,DiscordChannels,DiscordDirect,DiscordMarkdown,DiscordEmbed,DiscordMembers,DiscordThreads,DiscordServerManage}.tsx` |
| UnknownCheats Reader | Server core in `packages/web/server/lib/unknowncheats/`, UI surface `'unknowncheats'` pending Stage E |
| Browser Panel | `packages/ui/src/components/browser/BrowserPane.tsx` |
| Settings, Providers, About, Command Palette | `packages/ui/src/components/views/SettingsWindow.tsx`, `packages/ui/src/components/sections/`, `packages/ui/src/components/ui/{AboutDialog,AboutLogo,CommandPalette,UpdateDialog}.tsx` |
| Native Splash | `packages/desktop/splash/index.html` |

---

## 4. Prior Branding & Palette Audit (Root Causes of Red/Blue Drift)

Inspecting the checkpoint codebase revealed exact causes for the washed-out slate and red/blue chrome the user flagged:
1. `spleen-dark.json` used navy-slate surfaces (`#0B0F14` / `#121821` / `#1A222D`), vermilion primary (`#D9503F`), blue focus rings (`#83A7DC55`), blue info (`#83A7DC`), and blue markdown links (`#83A7DC`).
2. `design-system.css` mirrored `--background: #0B0F14`, `--card: #121821`, `--popover: #1A222D`, `--primary: #D9503F`, `--ring: #83A7DC`, `--brand-canary: #1C4AC2`.
3. `docs/brand/source/*.svg` & `scripts/brand/geometry.mjs` rendered the central blade in vermilion `#D9503F` over `#0B0F14` dark navy-slate tiles, stamped into `spleenLogoArt.ts`, `splash/index.html`, installer BMPs, and all 56 app icons.
4. `DiscordPanel.tsx` / `DiscordIntegrationCard.tsx` hardcoded Discord blurple (`#5865F2`, `#7289da`) and Tailwind `text-sky-400` / `bg-blue-500`.

---

## 5. Backend / IPC Boundaries Preserved

- **Express HTTP/SSE/WS Server** (`packages/web/server/index.js`):
  - OpenCode upstream proxy & SSE translation (`/api/events`, session message/permission/recovery/teams/discord/unknowncheats/settings routes).
  - Control plane (`packages/web/server/lib/spleen-control/`) exposing `settings.*`, `ui.control`, `session.*`, `recovery.*`, `team.*`, `discord.*`, `uc.*`.
- **Tauri IPC Bridge** (`packages/desktop/src-tauri/src/bridge.rs` <-> `packages/ui/src/lib/desktop.ts`):
  - Exposes `__SPLEEN_DESKTOP__.invoke('spleen_desktop_invoke', { cmd, args })` and native window/dialog/updater/tray/cookie commands.

---

## 6. Verified Build, Test & Brand Commands

- Web production build: `bun run build:web`
- Type checks: `bun run type-check:ui`, `bun run type-check:web`
- Server unit/route tests: `bun run --cwd packages/web vitest run <suite>`
- UI & surface invariant tests: `bun test <test-file>`
- Brand & icon generation / verification: `bun run brand:generate`, `bun run icons:generate`, `bun run brand:generate --check`, `bun run brand:audit`
- Desktop asset prep & tests: `bun run --cwd packages/desktop build`, `bun run --cwd packages/desktop test`
- Rust verification & signed NSIS packaging: `cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml --locked`, `bun run --cwd packages/desktop tauri:build`
