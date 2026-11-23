import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const config = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));

test('the packaged app carries every resource the server reads at runtime', () => {
  const targets = new Set(Object.values(config.bundle.resources));
  for (const entry of ['binaries/spleen-server.exe', 'web-dist/', 'opencode-cli/', 'built-in-extensions/']) {
    const found = [...targets].some((target) => target === entry || target.startsWith(entry.replace(/\/$/, '')));
    assert.ok(found, `missing bundle resource: ${entry}`);
  }
});

test('the installer stays a current-user NSIS install with the Spleen identity', () => {
  assert.equal(config.productName, 'Spleen');
  assert.equal(config.identifier, 'dev.spleen.desktop');
  assert.deepEqual(config.bundle.targets, ['nsis']);
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(config.bundle.windows.nsis.installerIcon, 'icons/icon.ico');
  assert.equal(config.bundle.windows.nsis.uninstallerIcon, 'icons/icon.ico');
  assert.equal(config.bundle.windows.nsis.headerImage, 'icons/installer-header.bmp');
  assert.equal(config.bundle.windows.nsis.sidebarImage, 'icons/installer-sidebar.bmp');
});

test('the bundled icon set is the approved Spleen mark', () => {
  assert.ok(config.bundle.icon.includes('icons/icon.ico'));
  const svg = fs.readFileSync(path.join(desktopRoot, 'src-tauri', 'icons', 'app-icon.svg'), 'utf8');
  assert.match(svg, /fill="#09090B"/);
  assert.match(svg, /fill="#FAFAFA"/);
  assert.match(svg, /fill="#90969E"/);
});

test('the updater points at the Spleen-owned feed', () => {
  assert.match(config.plugins.updater.endpoints[0], /^https:\/\/github\.com\/whft\/spleen\//);
  assert.notEqual(config.plugins.updater.pubkey, '', 'updater public key must be set before release');
});

test('the OpenCode CLI pin is a concrete version', () => {
  assert.match(packageJson.opencodeCli.version, /^\d+\.\d+\.\d+$/);
});
