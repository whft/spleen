#!/usr/bin/env node
/**
 * Writes every Spleen logo and icon file from the approved identity kit in
 * docs/brand/source.
 *
 *   bun run brand:generate          write all text and image outputs
 *   bun run brand:generate --check  fail when a text output is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SPLEEN_ACCENT,
  SPLEEN_INK,
  appIconSvg,
  flatLogoInner,
  flatLogoSvg,
  installerHeaderSvg,
  installerSidebarSvg,
  lightTileSvg,
  logoArtModule,
  markIconSvg,
  notificationIconXml,
  roundIconSvg,
  traySvg,
} from './geometry.mjs';
import { encodeBmp, encodeIco, svgToPng, svgToPngSize, composeOnSquare, flattenTo, centerOn } from './raster.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (...parts) => path.join(repoRoot, ...parts);

const MARK_START = '<!-- brand:flat-logo:start -->';
const MARK_END = '<!-- brand:flat-logo:end -->';

const INLINE_FILES = [
  'packages/desktop/splash/index.html',
  'packages/web/index.html',
  'packages/web/server/lib/opencode/static-routes-runtime.js',
  'packages/vscode/src/webviewHtml.ts',
];

const inlineMarkup = () => flatLogoInner({ color: 'currentColor' });

const replaceBetweenMarkers = (source, file, markup) => {
  const start = source.indexOf(MARK_START);
  const end = source.indexOf(MARK_END);
  if (start < 0 || end < start) throw new Error(`${file}: missing ${MARK_START} ... ${MARK_END}`);
  return source.slice(0, start + MARK_START.length) + markup + source.slice(end);
};

export const textOutputs = () => {
  const outputs = [
    [at('packages/ui/src/components/ui/spleenLogoArt.ts'), logoArtModule()],
    [at('packages/web/public/favicon.svg'), appIconSvg({ size: 32 })],
    [at('packages/web/public/logo-light-512x512.svg'), lightTileSvg({ size: 512 })],
    [at('packages/web/public/logo-dark-512x512.svg'), appIconSvg({ size: 512 })],
    [at('packages/desktop/src-tauri/icons/app-icon.svg'), appIconSvg({ size: 1024 })],
    [at('docs/references/badges/spleen-logo-dark.svg'), appIconSvg({ size: 64 })],
    [at('docs/references/badges/spleen-logo-light.svg'), lightTileSvg({ size: 64 })],
    [at('packages/vscode/assets/icon.svg'), markIconSvg({ size: 24, color: 'currentColor', dot: false })],
    [at('packages/vscode/assets/icon-titlebar.svg'), markIconSvg({ size: 24, color: '#F1F2EF' })],
    [at('packages/vscode/assets/icon-scm-titlebar.svg'), markIconSvg({ size: 24, color: '#C5C5C5', dot: false })],
    [at('packages/mobile/android/app/src/main/res/drawable/ic_stat_notify.xml'), notificationIconXml()],
  ];
  for (const file of INLINE_FILES) {
    const full = at(file);
    const source = fs.readFileSync(full, 'utf8');
    outputs.push([full, replaceBetweenMarkers(source, file, inlineMarkup())]);
  }
  return outputs;
};

export const imageOutputs = async () => {
  const iconPng = (size) => svgToPng(appIconSvg({ size }), size);
  const roundPng = (size) => svgToPng(roundIconSvg({ size }), size);
  const markPng = (size, color = SPLEEN_INK, dot = true) => (
    svgToPng(flatLogoSvg({ size, color, dot }), size)
  );
  const maskablePng = async (size) => {
    const inset = Math.ceil(size * 0.05);
    return composeOnSquare({
      png: await markPng(size - inset * 2),
      size,
      background: { r: 9, g: 9, b: 11, alpha: 1 },
      inset,
    });
  };
  const iconSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const size of iconSizes) icoEntries.push({ size, png: await iconPng(size) });

  const outputs = [
    [at('packages/web/public/favicon-16.png'), await iconPng(16)],
    [at('packages/web/public/favicon-32.png'), await iconPng(32)],
    [at('packages/web/public/favicon.png'), await iconPng(64)],
    [at('packages/web/public/pwa-192.png'), await iconPng(192)],
    [at('packages/web/public/pwa-512.png'), await iconPng(512)],
    [at('packages/web/public/pwa-maskable-192.png'), await maskablePng(192)],
    [at('packages/web/public/pwa-maskable-512.png'), await maskablePng(512)],
    [at('packages/web/public/apple-touch-icon.png'), await iconPng(180)],
    [at('packages/web/public/apple-touch-icon-120x120.png'), await iconPng(120)],
    [at('packages/web/public/apple-touch-icon-152x152.png'), await iconPng(152)],
    [at('packages/web/public/apple-touch-icon-167x167.png'), await iconPng(167)],
    [at('packages/web/public/apple-touch-icon-180x180.png'), await iconPng(180)],
    [at('packages/desktop/src-tauri/icons/32x32.png'), await iconPng(32)],
    [at('packages/desktop/src-tauri/icons/128x128.png'), await iconPng(128)],
    [at('packages/desktop/src-tauri/icons/128x128@2x.png'), await iconPng(256)],
    [at('packages/desktop/src-tauri/icons/icon.png'), await iconPng(512)],
    [at('packages/desktop/src-tauri/icons/tray.png'), await svgToPng(traySvg({ size: 32, color: '#FFFFFF' }), 32)],
    [at('packages/desktop/src-tauri/icons/installer-header.bmp'), await encodeBmp(await svgToPngSize(installerHeaderSvg(), 150, 57))],
    [at('packages/desktop/src-tauri/icons/installer-sidebar.bmp'), await encodeBmp(await svgToPngSize(installerSidebarSvg(), 164, 314))],
    [at('packages/desktop/src-tauri/icons/icon.ico'), encodeIco(icoEntries)],
    [at('packages/vscode/assets/app-icon.png'), await iconPng(256)],
    [at('packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), await flattenTo(await iconPng(1024), { r: 9, g: 9, b: 11, alpha: 1 })],
  ];

  const android = [
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ];
  for (const [density, size] of android) {
    const dir = at(`packages/mobile/android/app/src/main/res/mipmap-${density}`);
    outputs.push([`${dir}/ic_launcher.png`, await iconPng(size)]);
    outputs.push([`${dir}/ic_launcher_round.png`, await roundPng(size)]);
    outputs.push([`${dir}/ic_launcher_foreground.png`, await markPng(size)]);
    outputs.push([`${dir}/ic_launcher_monochrome.png`, await markPng(size, '#FFFFFF', false)]);
  }

  const splash = async (width, height) => {
    const size = Math.round(Math.min(width, height) * 0.3);
    return centerOn({
      png: await svgToPng(flatLogoSvg({ size, color: SPLEEN_INK }), size),
      width,
      height,
      background: { r: 9, g: 9, b: 11, alpha: 1 },
    });
  };
  const iosSplashDir = 'packages/mobile/ios/App/App/Assets.xcassets/Splash.imageset';
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    outputs.push([at(iosSplashDir, name), await splash(2732, 2732)]);
  }
  const androidSplash = [
    ['drawable/splash.png', 480, 320],
    ['drawable-land-hdpi/splash.png', 800, 480],
    ['drawable-land-mdpi/splash.png', 480, 320],
    ['drawable-land-xhdpi/splash.png', 1280, 720],
    ['drawable-land-xxhdpi/splash.png', 1600, 960],
    ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
    ['drawable-port-hdpi/splash.png', 480, 800],
    ['drawable-port-mdpi/splash.png', 320, 480],
    ['drawable-port-xhdpi/splash.png', 720, 1280],
    ['drawable-port-xxhdpi/splash.png', 960, 1600],
    ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
  ];
  for (const [name, width, height] of androidSplash) {
    outputs.push([at('packages/mobile/android/app/src/main/res', name), await splash(width, height)]);
  }

  return outputs;
};

const writeFile = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const stale = textOutputs().filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text);
  if (check) {
    if (stale.length > 0) {
      console.error(`stale brand outputs:\n${stale.map(([file]) => path.relative(repoRoot, file)).join('\n')}`);
      process.exit(1);
    }
    console.log(`brand outputs match (${textOutputs().length} text files)`);
  } else {
    for (const [file, text] of textOutputs()) writeFile(file, text);
    const images = await imageOutputs();
    for (const [file, buffer] of images) writeFile(file, buffer);
    console.log(`wrote ${textOutputs().length} text files and ${images.length} images`);
  }
}
