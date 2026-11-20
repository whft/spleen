# Spleen internal documentation

Start here. These pages describe the shipped system and the evidence behind it;
they are not aspirational.

| Page | Audience | Covers |
|---|---|---|
| [`roadmap/PROGRESS.md`](roadmap/PROGRESS.md) | Delivery | What is done, proven by which command, what is blocked |
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | Engineering | Tauri host, sidecar, OpenCode, data paths, boot and stop |
| [`architecture/RECOVERY.md`](architecture/RECOVERY.md) | Engineering | Durable session recovery guarantees and limits |
| [`operations/WINDOWS-DEV.md`](operations/WINDOWS-DEV.md) | Engineering | Build and run the desktop app on Windows |
| [`quality/EVIDENCE.md`](quality/EVIDENCE.md) | QA | Test/verification matrix with observed outcomes |
| [`upstream/UPSTREAM.md`](upstream/UPSTREAM.md) | Engineering | Source snapshot, license, divergence, upgrade plan |
| [`brand/BRAND.md`](brand/BRAND.md) | Design, engineering | Approved mark, palette, asset map and theme mapping |

Module contracts live beside their code, for example:

- `packages/web/server/lib/session-recovery/DOCUMENTATION.md`
- `packages/web/server/lib/event-stream/DOCUMENTATION.md`
- `packages/web/server/lib/opencode/DOCUMENTATION.md`
- `packages/desktop/DOCUMENTATION.md` (desktop build and host contract)
- `packages/sdk/DOCUMENTATION.md` (extension guest contract)

Public help content stays in `packages/docs/content/docs/`. Do not duplicate it
here.

## Open gaps

The ledger lists blockers with the owner action required. The largest are the
updater keypair and Windows code signing. iOS widget branding is a known gap for
a future iOS build.
