#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Every package.json a release bumps. `oc-dev create-release` imports this so
// the commit it suggests stages exactly these files.
export const RELEASE_PACKAGE_FILES = [
  'package.json',
  'packages/ui/package.json',
  'packages/web/package.json',
  'packages/sdk/package.json',
  'packages/desktop/package.json',
  'packages/vscode/package.json',
  'packages/mobile/package.json',
];
export const TAURI_CONF_FILE = 'packages/desktop/src-tauri/tauri.conf.json';
export const TAURI_CARGO_FILE = 'packages/desktop/src-tauri/Cargo.toml';

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const newVersion = process.argv[2];
  if (!newVersion || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
    console.error('Usage: node scripts/bump-version.mjs <version>');
    console.error('Example: node scripts/bump-version.mjs 0.2.0');
    console.error('Example: node scripts/bump-version.mjs 0.2.0-beta.1');
    process.exit(1);
  }

  console.log(`Bumping version to ${newVersion}\n`);

  for (const pkgPath of RELEASE_PACKAGE_FILES) {
    const fullPath = path.join(ROOT, pkgPath);
    const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const oldVersion = pkg.version;
    pkg.version = newVersion;
    fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ${pkgPath}: ${oldVersion} -> ${newVersion}`);
  }

  const tauriConfPath = path.join(ROOT, TAURI_CONF_FILE);
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  const oldTauriVersion = tauriConf.version;
  tauriConf.version = newVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  console.log(`  ${TAURI_CONF_FILE}: ${oldTauriVersion} -> ${newVersion}`);

  const cargoPath = path.join(ROOT, TAURI_CARGO_FILE);
  const cargo = fs.readFileSync(cargoPath, 'utf8');
  const packageStart = cargo.indexOf('[package]');
  const nextSection = packageStart === -1 ? -1 : cargo.indexOf('\n[', packageStart + 1);
  const splitAt = nextSection === -1 ? cargo.length : nextSection;
  const head = cargo.slice(0, splitAt);
  const bumpedHead = head.replace(/^version = "[^"]+"$/m, `version = "${newVersion}"`);
  if (packageStart === -1 || bumpedHead === head) {
    console.error(`  ${TAURI_CARGO_FILE}: could not find the [package] version line`);
    process.exit(1);
  }
  fs.writeFileSync(cargoPath, bumpedHead + cargo.slice(splitAt));
  console.log(`  ${TAURI_CARGO_FILE}: package version updated`);

  // Bun packs workspace:* using the lockfile's version, even after a frozen
  // install. Refresh it with the manifests before any release package is packed.
  execFileSync('bun', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: ROOT, stdio: 'inherit' });

  console.log('\nVersion bump complete. Review changes, then commit and tag.');
}
