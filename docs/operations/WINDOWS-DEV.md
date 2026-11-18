# Windows development

These are the commands verified on Windows 10.0.19045 with Bun 1.4.4 and
rustc 1.98.1.

> The `opencode` on `PATH` is an unrelated shim. Never use it to verify Spleen.
> The pinned CLI is `packages/desktop/src-tauri/resources/opencode-cli/opencode.exe`.

## Install and check

```powershell
cd C:\Users\Admin\Documents\Spleen
bun install
bun run type-check:ui
bun run type-check:web
bun run build
```

## Desktop build

```powershell
cd packages\desktop
node scripts/prepare-opencode-cli.mjs   # once per CLI pin change
node scripts/build-sidecar.mjs           # Bun --compile of the server
node scripts/stage-web-assets.mjs        # dist + built-in extensions into resources
cd src-tauri
cargo check
cargo run                                # dev launch
```

`cargo run` writes host logs to `spleen-references\spleen-run.log` when started
from the terminal, and the backend log to
`%LOCALAPPDATA%\Spleen\logs\server.log`.

## Verify the backend

```powershell
# read the sidecar port and UI password from the running process
$p = Get-CimInstance Win32_Process -Filter "Name='spleen-server.exe'"
$p.CommandLine
# health is unauthenticated
Invoke-RestMethod "http://127.0.0.1:<port>/health"
```

To create a real turn without touching an existing session, use the app's own
route with the free `big-pickle` model:

```powershell
POST /api/spleen/sessions
{ "title": "probe", "directory": "C:\\temp\\probe", "prompt": "Reply with pong", "model": "opencode/big-pickle" }
```

## Packaging

```powershell
cd C:\Users\Admin\Documents\Spleen
bun run desktop:build          # tauri build, NSIS current-user installer
bun run desktop:build:unsigned # same without updater signing; works before the keypair exists
```

`bun run desktop:dev` builds extensions and starts `tauri dev`; `bun run
desktop:build` does not run the extension build for you. A plain
`desktop:build` fails after bundling while the updater public key is set and no
`TAURI_SIGNING_PRIVATE_KEY` is present, because `bundle.createUpdaterArtifacts`
is `v1Compatible`; use `desktop:build:unsigned` for local and CI smoke builds.

The NSIS installer is a current-user install. The updater endpoint is
`https://github.com/whft/spleen/releases/latest/download/latest.json`; its public
key is still a placeholder until the owner generates the keypair.
