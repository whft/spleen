# Spleen brand identity

The approved identity kit (v1.0) is the source of every Spleen mark. Its vectors
live in `docs/brand/source`; its UI icon set is in `docs/brand/ui-icons`; its
authored palette is in `docs/brand/tokens.json`. The app never redraws the mark
by hand.

## Mark

Three interlocking sculpted S-shaped blades on a 1000-unit canvas: upper and
lower alabaster-bone blades framing a central diagonal vermilion core ribbon.
The app icon sets the mark on a near-black beveled squircle tile with corner
radius 217/1000.

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
| Canvas | `#080B0F` | dark `surface.muted`, sidebar, splash |
| Tile | `#0B0F14` | dark `surface.background`, chat canvas |
| Raised | `#121821` | dark `surface.elevated` |
| Panel | `#1A222D` | dark `surface.subtle`, popovers |
| Border | `#2C3743` | dark `interactive.border` |
| Bone | `#F3EFE7` | dark `surface.foreground` |
| Secondary | `#B0BAC4` | reference for muted text; the theme uses `#8C98A4` to keep secondary text near 5:1 on raised surfaces |
| Muted | `#798793` | icons, tertiary text |
| Accent | `#D9503F` | `primary.base`, brand node |
| Accent hover | `#E56858` | `primary.hover` |
| Accent soft | `#381B1D` | user message bubble |
| Success | `#76BE9D` | `status.success` |
| Warning | `#E6BA74` | `status.warning` |
| Danger | `#E46D68` | `status.error` |
| Focus | `#83A7DC` | `interactive.focusRing`, dark links |

The default `spleen-dark` theme uses these roles. `spleen-light` is the daylight
counterpart: paper `#FBF9F5`, ink `#12161C`, a darker vermilion `#C2463A` for
contrast, and the same status hues tuned for light surfaces.

## Geometry and type

- UI icon grid: 24x24, 1.85 stroke, round caps and joins.
- Control radii: 6, 10, 14 px; spacing basis 4 px.
- UI font stack: Inter, Segoe UI Variable, Segoe UI, system-ui, sans-serif.
- Mono stack: JetBrains Mono, Cascadia Code, Consolas, monospace.
- No gradients, glows, glass panels or decorative shadows in brand artwork.
- The existing component layout, keyboard navigation and density stay as they
  are. Branding changes the mark, icons and palette, not the information
  architecture.

## Asset rules

- Transparent exports keep their alpha. Tray and splash artwork never carry a
  baked background.
- The tray uses the monochrome glyph, never the rounded app tile.
- The vermilion dot belongs to the brand mark. Utility icons do not get a dot.
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
