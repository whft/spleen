import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { iconSpriteData } from '../../packages/ui/src/components/icon/sprite.ts';
import { textOutputs } from './generate.mjs';
import {
  FLAT_LOGO,
  SPLEEN_ACCENT,
  SPLEEN_CORE_PATH,
  SPLEEN_INK,
  SPLEEN_MARK_VIEWBOX,
  SPLEEN_UPPER_PATH,
  SPLEEN_TILE,
  appIconSvg,
  markIconSvg,
  sourceSvg,
  traySvg,
} from './geometry.mjs';
import { encodeIco, svgToPng } from './raster.mjs';
import sharp from 'sharp';

test('every generated text file matches scripts/brand', () => {
  const stale = [...textOutputs()]
    .filter(([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text)
    .map(([path]) => relative(process.cwd(), path));
  expect(stale).toEqual([]);
});

test('the generated mark matches the master monogram paths', () => {
  const master = sourceSvg('spleen-symbol-color-transparent.svg');
  for (const d of [...FLAT_LOGO.shell, SPLEEN_CORE_PATH]) {
    expect(master).toContain(`d="${d}"`);
  }
});

test('the app icon keeps the Spleen tile, bone blades and ember core', () => {
  const svg = appIconSvg({ size: 512 });
  expect(svg).toContain(`fill="${SPLEEN_TILE.fill}"`);
  expect(svg).toContain(`rx="${SPLEEN_TILE.rx}"`);
  expect(svg).toContain(`fill="${SPLEEN_INK}"`);
  expect(svg).toContain(`fill="${SPLEEN_ACCENT}"`);
});

test('the tray glyph is transparent and monochrome with no tile', () => {
  const svg = traySvg({ size: 32, color: '#FFFFFF' });
  expect(svg).not.toContain('<rect');
  expect(svg).not.toContain(SPLEEN_ACCENT);
  expect(svg).toContain('fill="#FFFFFF"');
});

test('the cropped UI mark uses the tight viewBox', () => {
  expect(markIconSvg({ size: 24 })).toContain(`viewBox="${SPLEEN_MARK_VIEWBOX}"`);
});

test('the UI sprite brand glyph follows the master path', () => {
  expect(iconSpriteData.spleen).toContain(SPLEEN_UPPER_PATH);
  expect(iconSpriteData.spleen).toContain(SPLEEN_CORE_PATH);
});

test('the rendered app icon keeps the kit tile, bone blade and ember core', async () => {
  const size = 256;
  const png = await svgToPng(appIconSvg({ size }), size);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const rgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

  expect(at(128, 25)).toEqual(rgb(SPLEEN_TILE.fill));
  expect(at(128, 58)).toEqual(rgb(SPLEEN_INK));
  expect(at(128, 128)).toEqual(rgb(SPLEEN_ACCENT));
});

test('the complete mark fits in the PWA maskable safe circle', async () => {
  for (const size of [192, 512]) {
    const icon = new URL(`../../packages/web/public/pwa-maskable-${size}.png`, import.meta.url);
    const pixels = await sharp(readFileSync(icon)).ensureAlpha().raw().toBuffer();
    let painted = 0;
    let clipped = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] < 16) continue;
      painted++;
      const pixel = offset / 4;
      if (Math.hypot(pixel % size + 0.5 - size / 2, Math.floor(pixel / size) + 0.5 - size / 2) > size * 0.4) clipped++;
    }
    expect(painted).toBeGreaterThan(size * size * 0.06);
    expect(clipped).toBe(0);
  }
});

test('an .ico directory points at each PNG with its size', () => {
  const pngs = [{ size: 16, png: Buffer.from('a') }, { size: 256, png: Buffer.from('bcd') }];
  const ico = encodeIco(pngs);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(2);
  expect(ico.readUInt8(6)).toBe(16);
  // 256 px is written as 0.
  expect(ico.readUInt8(6 + 16)).toBe(0);
  const offset = ico.readUInt32LE(6 + 16 + 12);
  expect(ico.subarray(offset, offset + 3).toString()).toBe('bcd');
});
