# Brand assets

## Ownership

`scripts/brand` turns the approved identity kit into every file each runtime
reads. The vectors live in `docs/brand/source`; `geometry.mjs` reads them,
`raster.mjs` produces PNG and `.ico` output, and `generate.mjs` writes the
outputs. `bun run brand:generate` rewrites all of them; `bun run brand:generate
--check` fails when a generated text file was edited by hand.

The identity itself, the colour map and the consumer list live in
`docs/brand/BRAND.md`. Change the source vector or the tokens there first, then
regenerate.

## Invariants

- Every mark comes from `docs/brand/source/spleen-app-icon.svg`,
  `spleen-symbol-color-transparent.svg` or `spleen-tray-white.svg`. No module
  keeps a second copy of the path or the dot coordinates.
- The app icon keeps the 217/1000 tile radius, `#0B0F14` tile, `#F3EFE7` bone
  blades and `#D9503F` central vermilion blade.
- Tray and splash images have an alpha channel and no baked background. The tray
  is the monochrome glyph; the rounded tile never goes in the tray.
- The NSIS header and sidebar bitmaps are 24-bit BMPs built from the same tile,
  bone blades and vermilion core. The installer and uninstaller use `icon.ico`.
- The vermilion core belongs to the brand mark and the app icon. The tray glyph
  and generic UI icons render monochrome.
- The four documents that render before React (`packages/desktop/splash/index.html`,
  `packages/web/index.html`, the VS Code loader in `webviewHtml.ts`, the headless
  server page in `static-routes-runtime.js`) and `SpleenLogo.tsx` draw the same
  1000-unit path.
  The HTML documents carry it between `<!-- brand:flat-logo:start -->` and
  `<!-- brand:flat-logo:end -->`; the generator rewrites only that region.
- `packages/web/public/favicon.svg` and the Tauri `app-icon.svg` are the app
  icon, not a bare symbol, so they stay visible on both light and dark chrome.
- Text outputs are checked by `generate.test.mjs`; image bytes are not, because
  they depend on the libvips build. The Windows build plus the installer smoke
  test cover the raster outputs.
- Generic UI icons stay on `@/components/icon/Icon`. `docs/brand/ui-icons` is
  source material for app-specific marks, not a replacement icon library.

## Decisions

### Why the generator reads the SVG source

The kit ships one master and many exports. Keeping the path in TypeScript, the
tray in Rust and the loader in HTML would let them drift. Parsing the master at
generation time gives one path, one stroke and one dot for every output; a
change to the master propagates on the next `brand:generate`.

### Why the inline loader uses a 1000-unit viewBox

The previous mark used a 100-unit viewBox with a separately scaled path. The
kit's path is authored in 1000 units; keeping those coordinates avoids a scale
step that would change the stroke and dot radii. The in-app logo, the web
loader, the VS Code loader and the headless page all use the same numbers.

### Why the tray glyph is cropped out of the app tile

Windows shows a tray icon at 16 to 32 pixels. The rounded tile turns into a dark
blob there, and the kit explicitly calls for a transparent monochrome glyph.
`tray.png` is the white glyph from `spleen-tray-white.svg`; the tile stays in the
taskbar and installer icon.

### Why the in-app logo breathes instead of lighting tiers

The inherited mark had three roof tiers that lit in sequence. The S has no
tiers, so `SpleenLogo` and the VS Code loader fade the whole mark through one
opacity step every two seconds. The logo's geometry never moves.

## Known gap

The iOS widget keeps a hand-written copy of the path in
`packages/mobile/ios/App/SpleenWidget/WidgetShared.swift`. `brand:generate` does
not write Swift, and the Windows build does not compile it. Check it in an iOS
build before shipping the widget.
