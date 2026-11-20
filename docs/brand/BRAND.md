# Spleen brand identity

The approved identity kit (v1.0) is the source of every Spleen mark. Its vectors
live in `docs/brand/source`; its UI icon set is in `docs/brand/ui-icons`; its
authored palette is in `docs/brand/tokens.json`. The app never redraws the mark
by hand.

## Mark

Three interlocking sculpted S-shaped blades on a 1000-unit canvas: upper and
lower alabaster-bone (`#F1F2EF`) blades framing a central diagonal brushed-titanium
(`#959D9C`) core ribbon.
The app icon sets the mark on an obsidian squircle tile (`#08090A`, border `#282D30`)
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
| Canvas | `#08090A` | dark `surface.background`, chat canvas |
| Sidebar / Recess | `#0B0D0F` | dark `surface.muted`, sidebar, splash |
| Raised | `#111416` | dark `surface.elevated`, menus, panels |
| Subtle | `#171B1D` | dark `surface.subtle`, hover, bubbles |
| Border | `#282D30` | dark `interactive.border` |
| Bone | `#F1F2EF` | dark `surface.foreground` |
| Secondary / Titanium | `#959D9C` | `surface.mutedForeground`, center blade |
| Primary Action | `#E5E8E3` | monochrome `primary.base` (`#08090A` ink) |
| Micro-Accent | `#C8FA62` | surgical focus glint & live dots only |
| Success | `#829E4B` | `status.success` |
| Warning | `#C9A45C` | `status.warning` |
| Danger | `#C46B6B` | `status.error` |
| Focus | `#C8FA6244` | `interactive.focusRing` |

The default `spleen-dark` theme uses these Obsidian Monochrome roles. `spleen-light`
is the neutral daylight counterpart (`#F7F8F6` background, `#111416` ink) with zero red/blue saturation.

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
