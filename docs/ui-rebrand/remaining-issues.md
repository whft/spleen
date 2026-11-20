# Spleen Obsidian UI Rebrand & v1.0.0 — Remaining Issues & Honest Limitations

1. **UnknownCheats Interactive Verification**:
   - When `unknowncheats.me` serves a Cloudflare challenge or requires forum login, Spleen intentionally does **not** bypass or automate CAPTCHAs. Instead, `UnknownCheatsPanel` surfaces a Verification Gate card that opens Spleen's visible Tauri WebView window (`desktop_uc_open_window`) so the user can complete verification normally and click **Sync Verified Session** (`desktop_uc_read_cookies`).
2. **Windows Code-Signing Certificate (SmartScreen) vs. Tauri Updater Signing**:
   - The Tauri v2 updater payload signature (`.sig` / `TAURI_SIGNING_PRIVATE_KEY`) is fully configured and verified against `tauri.conf.json` `plugins.updater.pubkey`.
   - An Authenticode EV/OV Windows certificate (`WINDOWS_CERTIFICATE_BASE64`) is left optional in `.github/workflows/release.yml` until an organization certificate is provisioned.
3. **External Design Tooling Notes**:
   - Spline MCP was not present in the active MCP environment, so the 3D Spleen Monolith was engineered natively offline in `three@0.187.0` (`SpleenMonolith3DScene.tsx`) using the exact `SPLEEN_LOGO_ART` 3-blade vector geometry and procedural `RoomEnvironment` reflections.
   - `npx motion-ai` was intentionally not executed because its CLI mutates global editor MCP configuration; project-local design and motion skills were installed under `.agents/skills/` and standard `motion/react` + CSS transitions were used.
