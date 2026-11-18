# Upstream

## Source

- Project: OpenChamber (MIT), source snapshot commit
  `9443e94c613578c3f0eca4c171d9af4cbd8df514`, version `2.7.2-281`.
- The Spleen tree was created from `git archive` of that commit, with new
  history. Upstream history and remotes are not present.
- `LICENSE` keeps the upstream MIT notice; redistribution must keep it.

## What changed

- Product identity: names, package scope, paths, env prefixes, protocols,
  icons, installer metadata, updater feed and app data directories.
- Desktop runtime: `packages/electron` removed; `packages/desktop` is a Tauri 2
  host written in Rust. No Electron dependency, preload, or Electron updater.
- Backend stays the original Bun/Node server, compiled into a single sidecar.
- OpenCode CLI is pinned (`packages/desktop/package.json` → `opencodeCli.version`)
  and staged per architecture; OpenCode API identifiers are unchanged.
- New: durable session recovery (`packages/web/server/lib/session-recovery`).

## Compatibility boundary

- OpenCode's own API, SDK and event vocabulary keep their identifiers. The SDK
  package is `@spleen/sdk` for Spleen extensions.
- The web/API layer keeps the upstream routes; Spleen additions are namespaced
  (`/api/spleen/*`, `/api/recovery/*`).
- Branding exceptions required for migration (for example an inherited data
  directory) must be listed in the rename inventory and covered by a test; a
  blanket exclusion is not acceptable.

## Upgrading from upstream

1. Diff the new OpenChamber release against the pinned commit outside the
   product repo.
2. Port UI and server commits with tests; keep Spleen-owned files
   (`packages/desktop`, `session-recovery`, brand scripts, docs) untouched by
   bulk renames.
3. Re-run the compatibility fixes for compiled Bun: static JSON/text imports,
   `Bun.main` entry detection, host-supplied resource paths.
4. Re-run the evidence matrix in `docs/quality/EVIDENCE.md` and update
   `docs/roadmap/PROGRESS.md`.

The pinned CLI/SDK pair is a contract; changing either needs an upgrade pull
request with the contract tests and a recorded before/after.
