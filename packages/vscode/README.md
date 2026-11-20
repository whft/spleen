# Spleen VS Code Extension

[![License: MIT](https://img.shields.io/badge/license-MIT-66800B?style=flat&labelColor=100F0F)](../../LICENSE)
[OpenCode](https://opencode.ai) AI coding agent, right inside your editor. No tab-switching, no context loss.

**Like the extension? There's also a [desktop app and web version](https://github.com/whft/spleen) with even more features.**

## What you get

- **Chat beside your code** — responsive layout that adapts to narrow and wide panels
- **Run on several models** — send one prompt to several models at once, compare the answers side by side, keep the best or fuse them
- **Right-click actions** — add context, explain selections, and improve code in-place
- **Click-to-open** — file paths in tool output open directly in your editor; edit-style results land in a focused diff view
- **Session editor panel** — keep chat sessions open alongside files
- **Theme-aware** — adapts to your VS Code light, dark, and high-contrast themes

Plus everything from the shared Spleen UI: branchable timeline, smart tool UIs, voice mode, Git workflows, and more.

## Commands

With no folder open, new sessions start in Chats. Each chat has its own directory
under `~/.config/spleen/chats`. Open a workspace folder to use project sessions.

| Command | Description |
|---------|-------------|
| `Spleen: Focus Chat` | Focus the chat panel |
| `Spleen: New Session` | Start a new chat session |
| `Spleen: Open Sidebar` | Open the Spleen sidebar |
| `Spleen: Run on Several Models` | Open a new tab set up to run one prompt on several models |
| `Spleen: Open Session in Editor` | Open current or new session in an editor tab |
| `Spleen: Settings` | Open Settings in an editor tab. Repeat invocations reveal the same tab and leave the chat sidebar unchanged. |
| `Spleen: Restart API Connection` | Restart the OpenCode API process |
| `Spleen: Show OpenCode Status` | Debug info for development or bug reports |
| `Spleen: Generate Commit Message` | Fill VS Code's Source Control commit box from staged changes, or unstaged if nothing is staged |

### Right-click menu

Select code in the editor, right-click, and find the **Spleen** submenu:

| Action | Description |
|--------|-------------|
| Add to Context | Attach selection to your next prompt |
| Add Comment | Open a comment thread on the selected lines. The comment stays anchored in the editor and goes out with your next message as a context card. The gutter `+` does the same once the extension is active |
| Explain | Ask the agent to explain the selected code |
| Improve Code | Ask the agent to improve the selection in-place |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `spleen.apiUrl` | _(empty)_ | URL of an external OpenCode API server. Leave empty to auto-start a local instance. Authenticates with `OPENCODE_PASSWORD` (or the legacy `OPENCODE_SERVER_PASSWORD`); when both are unset and the URL points at OpenCode's background service (`opencode service start`), the service's own password is used. |
| `spleen.opencodeBinary` | _(empty)_ | Absolute path to the `opencode` CLI binary. Useful when PATH lookup fails. Requires window reload to apply. |

Both settings belong to one machine. In a Remote-SSH window the extension ignores the values from your local User settings: set them in the Remote or Workspace tab of the Settings editor. With no value on the server, the extension finds `opencode` there on its own.

npm metadata and OpenCode version checks use the registry from the extension host environment or the user's `.npmrc`, including scoped registries and authentication.

## Requirements

- [OpenCode CLI](https://opencode.ai) installed and available in PATH (or set `OPENCODE_BINARY` env var)
- VS Code 1.85+

<details>
<summary>Development</summary>

```bash
bun install
bun run vscode:dev
```

`bun run vscode:dev` now starts watchers + opens an Extension Development Host automatically. Webview UI changes use Vite HMR automatically.

Optional overrides:

- `SPLEEN_VSCODE_BIN=cursor bun run vscode:dev`
- `SPLEEN_VSCODE_DEV_WORKSPACE=/path/to/workspace bun run vscode:dev`
- `bun run vscode:dev /path/to/workspace`
- `SPLEEN_VSCODE_REMOTE_DEBUGGING_PORT=9334 bun run vscode:dev` runs the host as its own VS Code instance in a throwaway profile, with Chrome DevTools Protocol on that port, even while another VS Code is open. The Spleen webview is the `vscode-webview://` iframe target; its document is that target's inner `iframe`. Stopping the script closes the instance and removes the profile.

To package manually:

```bash
bun run --cwd packages/vscode build
cd packages/vscode && bunx vsce package --no-dependencies
```

Install locally: `code --install-extension packages/vscode/spleen-*.vsix`

The Settings command regression check runs in the real extension host after
`bun run vscode:build`. With an isolated home and OpenCode data directories, run:

```bash
SPLEEN_DISABLE_WEBVIEW_HMR=1 code --disable-extensions --skip-welcome \
  --user-data-dir=/path/to/temporary-profile \
  --extensions-dir=/path/to/temporary-extensions \
  --extensionDevelopmentPath="$PWD/packages/vscode" \
  --extensionTestsPath="$PWD/packages/vscode/src/settings-command.integration.cjs"
```

It checks null and omitted arguments, valid navigation, repeated invocation,
and rejection of malformed navigation. It is separate from `bun run test`
because it needs VS Code's extension API and window.

</details>

## License

MIT
