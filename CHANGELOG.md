# Changelog

<!-- Legacy copy for app versions up to 1.22.1, which fetch this file for their update notes. Generated from changelog/*.md while it exists; delete it after 2026-09-19 and nothing will recreate it. -->

## [1.1.0] - 2026-11-22

Major desktop polish and capability release adding full Desktop SSH tunneling, working multi-device LAN access, expanded 3D Obsidian spatial visuals, draggable sidebar chats, custom project agent orchestration inside AI Teams, proper UnknownCheats login & search, and refined Discord/UC iconography.

### New

- **3D Obsidian Space:** Full-bleed architectural 3D spatial backdrop (`SpleenSpatialStage3D`) behind the Welcome workspace, counter-tilted telemetry rings on the 3D Spleen monolith, and an interactive 3D Agent Constellation (`TeamConstellation3D`) inside AI Teams
- **AI Teams & Project Agents:** Workspace picker, customizable per-member role/agent/model roster, structured Lead Manager kickoff orchestration, inline member spawner, and an in-panel Project Agents manager (`.opencode/agents/*.md`) with one-click Recruit to Team
- **Sidebar Drag-to-Project:** Drag any non-archived chat row from Chats or Projects onto any project header to move the session tree cleanly
- **Desktop SSH Instances:** Full Rust OpenSSH backend implementing `~/.ssh/config` host import, managed/external remote Spleen tunneling, extra port forwards (`-L`/`-R`/`-D`), live status events, and streaming tunnel logs
- **Expanded AI Tool Access:** Full `agent.*`, `team.*`, `discord.*`, and `uc.*` control actions wired into `spleen_control` so Spleen AI can read/search/react/create threads in Discord, browse/bookmark UnknownCheats, and create/orchestrate project agents and teams

### Improvements

- **Icons:** Added verified official Discord Clyde SVG, bespoke beveled UnknownCheats (`UC`) emblem, and AI Teams orchestrator graph icon to the icon sprite
- **UnknownCheats Reader:** Added direct account login, interactive browser verification login with automatic cookie & WebView2 `User-Agent` synchronization, Recent Posts tab, and thread prefix badges
- **Multi-Device LAN Access:** Desktop host now honors saved `desktopLanAccessEnabled` and `desktopUiPassword` settings, binding `0.0.0.0` on stable preferred port `3721` with fallback LAN IP detection

### Fixes

- **Discord Reader:** Fixed vertically squished server icons in the guild rail, added active/hover Discord rail indicators, collapsible channel categories, toggleable channel drawer with profile footer, and inline DM creation
- **UnknownCheats Search:** Fixed `/api/unknowncheats/search` query parameter mismatch (`q` vs `query`) and Cloudflare `User-Agent` mismatch on synced cookies

## [1.0.0] - 2026-11-20

Initial stable Windows desktop release of Spleen featuring the Obsidian dark monochrome design system, sculptural 3D monolith identity, live session-recovery & limit failover, AI Teams DAG orchestrator, full in-app AI control, Discord reader/client, and UnknownCheats reader.

### New

- **Design:** Complete Obsidian dark monochrome UI overhaul with self-hosted Geist & Geist Mono typography, precision 3-blade brand mark, and lazy-loaded Three.js 3D monolith on Welcome and About screens
- **AI Teams:** Multi-agent DAG orchestrator with planner/coder/reviewer/tester presets and live execution panel
- **AI Control:** Full in-app `spleen-control` skill allowing Spleen AI to inspect and control settings, UI surfaces, session recovery, AI Teams, Discord, and UnknownCheats
- **Discord:** Integrated Discord reader and live Gateway client with guild/channel browser, thread viewer, search, and one-click Send to Spleen AI
- **UnknownCheats:** Integrated UnknownCheats forum and code-block reader with Tauri verification window bridge, bookmarks, search, and Send to Spleen AI
- **Recovery:** Automatic usage-limit failover, stall watchdog, exponential backoff auto-continue, and in-chat recovery status banner

### Improvements

- **Desktop:** Signed Windows NSIS installer and GitHub Releases updater integration for `whft/spleen`
- **Browser:** Native window popout support in the embedded browser panel

### Fixes

- **Status:** Cleaned up work-status usage copy and removed legacy red/blue surface accents
