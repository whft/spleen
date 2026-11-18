#!/usr/bin/env node
/**
 * Writes every Spleen logo and icon file from scripts/brand/geometry.mjs.
 *
 *   bun run brand:generate          write all text and image outputs
 *   bun run brand:generate --check  fail when a text output is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appIconSvg, flatLogoInner, flatLogoSvg, logoArtModule, traySvg } from './geometry.mjs';
import { encodeIco, svgToPng, composeOnSquare } from './raster.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (...parts) => path.join(repoRoot, ...parts);

const MARK_START = '<!-- brand:flat-logo:start -->';
const MARK_END = '<!-- brand:flat-logo:end -->';

const INLINE_FILES = [
  'packages/web/index.html',
  'packages/web/server/lib/opencode/static-routes-runtime.js',
  'packages/vscode/src/webviewHtml.ts',
];

const inlineMarkup = () => flatLogoInner({ color: 'currentColor', idPrefix: 'spleen-logo-' })
  .replace(/<path data-tier="(\d)"/g, (match) => match);

const replaceBetweenMarkers = (source, file, markup) => {
  const start = source.indexOf(MARK_START);
  const end = source.indexOf(MARK_END);
  if (start < 0 || end < start) throw new Error(`${file}: missing ${MARK_START} ... ${MARK_END}`);
  return source.slice(0, start + MARK_START.length) + markup + source.slice(end);
};

export const textOutputs = () => {
  const outputs = [
    [at('packages/ui/src/components/ui/spleenLogoArt.ts'), logoArtModule()],
    [at('packages/web/public/favicon.svg'), flatLogoSvg({ color: '#0b0f14', size: 32 })],
    [at('packages/web/public/logo-light-512x512.svg'), appIconSvg({ size: 512 })],
    [at('packages/web/public/logo-dark-512x512.svg'), appIconSvg({ size: 512 })],
    [at('packages/desktop/src-tauri/icons/app-icon.svg'), appIconSvg({ size: 1024 })],
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
  const iconSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const size of iconSizes) icoEntries.push({ size, png: await iconPng(size) });

  const outputs = [
    [at('packages/web/public/favicon-16.png'), await iconPng(16)],
    [at('packages/web/public/favicon-32.png'), await iconPng(32)],
    [at('packages/web/public/pwa-192.png'), await iconPng(192)],
    [at('packages/web/public/pwa-512.png'), await iconPng(512)],
    [at('packages/web/public/pwa-maskable-192.png'), await composeOnSquare({
      png: await iconPng(192),
      size: 192,
      background: { r: 11, g: 15, b: 20, alpha: 1 },
      inset: 0,
    })],
    [at('packages/web/public/pwa-maskable-512.png'), await composeOnSquare({
      png: await iconPng(512),
      size: 512,
      background: { r: 11, g: 15, b: 20, alpha: 1 },
      inset: 0,
    })],
    [at('packages/web/public/apple-touch-icon.png'), await iconPng(180)],
    [at('packages/web/public/apple-touch-icon-120x120.png'), await iconPng(120)],
    [at('packages/web/public/apple-touch-icon-152x152.png'), await iconPng(152)],
    [at('packages/web/public/apple-touch-icon-167x167.png'), await iconPng(167)],
    [at('packages/web/public/apple-touch-icon-180x180.png'), await iconPng(180)],
    [at('packages/desktop/src-tauri/icons/32x32.png'), await iconPng(32)],
    [at('packages/desktop/src-tauri/icons/128x128.png'), await iconPng(128)],
    [at('packages/desktop/src-tauri/icons/128x128@2x.png'), await iconPng(256)],
    [at('packages/desktop/src-tauri/icons/icon.png'), await iconPng(512)],
    [at('packages/desktop/src-tauri/icons/tray.png'), await svgToPng(traySvg({ size: 32 }), 32)],
    [at('packages/desktop/src-tauri/icons/icon.ico'), encodeIco(icoEntries)],
  ];
  return outputs;
};

const writeFile = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

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
