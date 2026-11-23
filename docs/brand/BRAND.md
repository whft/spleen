# Spleen brand identity

The approved identity kit (v2.0, Keystone Fold S + Spleen Studio) is the source of every Spleen mark. Its vectors
live in `docs/brand/source`; its UI icon set is in `docs/brand/ui-icons`; its
authored palette is in `docs/brand/tokens.json`. The app never redraws the mark
by hand.

## Mark

An exact 180-degree symmetric sculpted S-ribbon ("Keystone Fold S") on a 1000-unit canvas:
upper and lower alabaster (`#FAFAFA`) sculpted curved arches separated by crisp parallel diagonal
cuts framing a floating brushed-titanium (`#90969E`) diamond keystone core.
The app icon sets the mark on an obsidian squircle tile (`#09090B`, border `#27272B`)
with corner radius 217/1000.

| Variant | Source | Use |
|---|---|---|
| App icon | `source/spleen-app-icon.svg` | Windows installer, taskbar, PWA, Apple touch, VS Code Marketplace, iOS and Android icons |
| Round icon | `source/spleen-app-round.svg` | Android round launcher |
| Light tile | `source/spleen-light-tile.svg` | light README badge, `logo-light-512x512.svg` |
| Symbol | `source/spleen-symbol-color-transparent.svg` | in-app logo, splash, loading states |
| Monochrome symbol | `source/spleen-symbol-bone-transparent.svg`, `spleen-symbol-ink-transparent.svg`, `spleen-symbol-white-transparent.svg` | single-colour contexts |
| Tray | `source/spleen-tray-white.svg`, `spleen-tray-black.svg` | Windows notification area, no tile |
| Ring | `source/spleen-ring-bone.svg`, `spleen-ring-white.svg` | optional splash artwork |

## Color

| Token | Value | Theme role |
|---|---|---|
| Sidebar / Recess | `#060607` | dark `surface.muted`, obsidian left sidebar & right rail |
| Studio Canvas | `#101012` | dark `surface.background`, calm graphite workspace canvas |
| Popover / Overlay | `#151518` | dark `surface.overlay`, floating menus & command sheet |
| Raised Card / Composer | `#1A1A1E` | dark `surface.elevated`, sculpted composer & cards |
| Subtle / Hover | `#26262B` | dark `surface.subtle`, active pills & tactile hovers |
| Border | `#27272B` | dark `interactive.border` (`borderHover: #3A3A40`) |
| Alabaster Ink | `#FAFAFA` | dark `surface.foreground` & monochrome `primary.base` (`#09090B` ink) |
| Secondary / Titanium | `#A1A1AA` | `surface.mutedForeground` (`#90969E` keystone core) |
| Status Live / Success | `#34D399` | `status.success` (surgical live dots & connected indicators) |
| Warning | `#D4A553` | `status.warning` |
| Danger | `#E06C75` | `status.error` |
| Focus | `#FAFAFA33` | `interactive.focusRing` |

The default `spleen-dark` theme uses these Spleen Studio Neutral roles. `spleen-light`
is the clean daylight gallery counterpart (`#FFFFFF` canvas, `#F6F6F7` sidebar, `#09090B` ink) with zero saturated chrome casts.

## Geometry and type

- UI icon grid: 24x24, 1.85 stroke, round caps and joins.
- Control radii: 4, 6, 9, 12 px; spacing basis 4 px.
- UI font stack: Geist Variable, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif.
- Mono stack: Geist Mono Variable, Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace.
- No gradients, glows, glass panels or decorative shadows in brand artwork.
- The existing component layout, keyboard navigation and density stay as they
  are. Branding changes the mark, icons and palette, not the information
  architecture.

## Asset rules

- Transparent exports keep their alpha. Tray and splash artwork never carry a
  baked background.
- The tray uses the monochrome glyph, never the rounded app tile.
- The titanium core belongs to the brand mark and the app icon. Utility icons do not get a dot.
- Light surfaces use the ink symbol or light tile. Never place bone artwork on
  white.
- Generic UI icons stay on the existing Remixicon `Icon` component. The kit's
  24 UI SVGs are kept as shape reference and for app-specific marks only.
- Every generated file comes from `bun run brand:generate`; `--check` fails when
  a text output was edited by hand.

## Where the assets go

| Output | Consumer |
|---|---|
| `packages/desktop/src-tauri/icons/icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` | Tauri bundle, NSIS installer, taskbar and Start menu |
| `packages/desktop/src-tauri/icons/installer-header.bmp`, `installer-sidebar.bmp` | NSIS header strip and welcome/finish panel |
| `packages/desktop/src-tauri/icons/tray.png` | Tauri tray, compiled into the binary |
| `packages/desktop/src-tauri/icons/app-icon.svg` | editable source copy for the desktop shell |
| `packages/web/public/favicon.svg`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon*.png` | browser tabs, iOS home screen |
| `packages/web/public/pwa-*.png` | web app manifest, installable PWA |
| `packages/web/public/logo-dark-512x512.svg`, `logo-light-512x512.svg` | README and external links |
| `packages/desktop/splash/index.html`, `packages/web/index.html`, `packages/vscode/src/webviewHtml.ts`, `packages/web/server/lib/opencode/static-routes-runtime.js` | pre-React loading mark |
| `packages/ui/src/components/ui/spleenLogoArt.ts` | React `SpleenLogo` |
| `packages/vscode/assets/app-icon.png`, `icon.svg`, `icon-titlebar.svg`, `icon-scm-titlebar.svg` | Marketplace icon, activity bar and view title icons |
| `packages/mobile/ios/.../AppIcon-512@2x.png`, `Splash.imageset` | iOS app icon and launch screen |
| `packages/mobile/android/.../mipmap-*`, `drawable-*` | Android launcher, adaptive icon, splash and notification small icon |
| `packages/ui/src/components/icon/sprite.ts` (`spleen`) | brand glyph in model pickers and tool rows |
| `docs/references/badges/spleen-logo-*.svg` | README header |

## Verification

```bash
bun run brand:generate --check
bun run brand:audit
bun run --cwd packages/desktop test
```

The generator test checks that every generated text output matches the checked-in
files and that the app icon keeps the tile, bone stroke and accent node. Windows
builds then verify the installer, taskbar, tray and splash in the real app.
