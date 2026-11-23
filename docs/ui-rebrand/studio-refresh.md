# Spleen Studio refresh

The Fold mark is a mirrored ribbon with a diagonal center. Incision explores a solid shape with cut-out space. Span uses an open frame with a diagonal bridge. The Fold keeps the existing S recognizable at favicon and tray sizes, where the other two silhouettes lose their smaller spaces first. The [editable concept plate](spleen-icon-concepts.svg) includes 16 px and 24 px samples.

Graphite frames the workspace with a recessed sidebar, a distinct composer, and a muted green selection color. Paper applies the same hierarchy to daylight. An alternate high-contrast direction used white against black throughout; it made supporting controls compete with the chat and status colors. The built-in themes carry the chosen colors, while shared controls and layouts inherit their surface and text tokens.

- The titlebar displays the Spleen wordmark in the open navigation area. Session search and the context rail have visible resting, current, hover and focus states.
- The welcome view shares `DraftStudioHero` across the desktop (`renderComposerForm.tsx`) and compact/mobile (`DraftWelcome.tsx`) paths with a single `<h1>`, the Fold emblem inside `oc-studio-emblem`, responsive heading wrapping, and reduced-motion support.
- The model picker, composer, settings, command palette, active chat tool rows, recovery status banner, multi-run lane cards, AI Teams topology/tabs, browser toolbar/empty state, and integration toolbars share the updated surface hierarchy, keyboard focus rings, tabular numbers, and reduced-motion classes. Model metadata and state indicators continue to use their existing data sources.
- Windows window actions use the Tauri core window API from the trusted loopback window. Maximize updates target the owning window. The close action follows the existing minimize-to-tray preference.

## Performance pass

`fast-anything v0.8.0` (`@el4cteo/fast-anything`, MIT, installed globally outside production dependencies) passed `fast-anything doctor` and profiled a deterministic synthetic workload across Spleen's search modules (`rankBySubsequence`, `rankConversationMetadata`, `rankByQuery`, and `matchesRankQuery`). Profiling identified `subsequenceSearch.ts` (`positionBonuses`/`classify` and `alignToken` typed-array allocations) and `fuzzySearch.ts` (eager `compactText` regex passes and per-word-start `slice` + regex scans in `matchesTokenAtWordStart`) as the dominant hotspots.

Optimizing both modules in portable TypeScript (preserving Web, Desktop, Mobile, and VS Code compatibility with zero added dependencies) reduced 5-run synthetic benchmark median runtime from **803.03 ms** to **342.91 ms** (**2.34x faster**, 57.3% lower latency) and reduced `fast-anything scan` profiled runtime from **1.06 s** to **539 ms**, verified with 32/32 search unit tests and 750/750 differential parity checks across ASCII, Unicode, path, fuzzy, and sidebar word-start queries.

## Live web UI captures (isolated synthetic workspace)

Captured against a live production build served from an isolated data directory with a synthetic `demo-workspace` Git repository and demo models (no private user projects, chats, or credentials):

- [Dark Welcome (1280x860)](screenshots/studio-live-dark-welcome.png)
- [Light Welcome (1280x860)](screenshots/studio-live-light-welcome.png)
- [Dark Settings Appearance (1280x860)](screenshots/studio-live-dark-settings.png)
- [Light Settings Appearance (1280x860)](screenshots/studio-live-light-settings.png)
- [Dark Command Palette (1280x860)](screenshots/studio-live-dark-command-palette.png)
- [Dark Git Panel (1280x860)](screenshots/studio-live-dark-git.png)
- [Dark Browser Panel (1280x860)](screenshots/studio-live-dark-browser.png)
- [Mobile Welcome (390x844)](screenshots/studio-live-mobile-390-welcome.png)

## Reference inventory

The local `krea-complete` folder contains 54 JPG captures, `DESIGN.md`, `README.md`, `catalog.json`, `tokens.css`, and `tokens.json`. Its catalog describes captured browser states. The folder is a reference archive. The reviewed product images include Home, Agent, the composer, model picker, workspace settings, light mode, Nodes, Assets, account menu and generation options. No assets from that archive are included in the app.

| Source | Access and use |
| --- | --- |
| [Krea app](https://www.krea.ai/app) and [redesign article](https://www.krea.ai/blog/redesign) | Public browser and article access. Reference for sidebar hierarchy, model selection and the composer. |
| [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Public article. Reference for separating orientation from surface-specific controls. |
| [Base UI](https://base-ui.com/react/components/menu) and [shadcn registry](https://ui.shadcn.com/docs/components/base/dropdown-menu) | Public docs and component examples. Existing menu primitives and keyboard behavior retained. |
| [Remix Icon](https://github.com/Remix-Design/RemixIcon#license) | Public license and source. The existing icon dependency supplies utility icons. |
| [Motion](https://motion.dev/docs/react-use-reduced-motion) | Public docs. Existing reduced-motion paths and CSS preference used. |
| [fast-anything](https://github.com/EL4CTEO/fast-anything) | Public MIT repository. Installed globally outside production dependencies (`v0.8.0`); ran `fast-anything doctor` and `fast-anything scan` against the synthetic search benchmark. |

The editable app masters live in `docs/brand/source`. Run `bun run brand:generate` and `bun run icons:generate` after changing the mark. `bun run brand:generate --check` checks the generated text assets. The brand tests also verify the sprite and rendered icon output.

The [Windows icon contact sheet](screenshots/studio-fold-icon-sizes.png) shows the generated ICO entries at their actual sizes. The PWA raster tests measure the mark against the maskable safe circle.
