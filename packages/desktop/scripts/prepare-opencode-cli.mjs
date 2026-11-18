// Downloads the pinned OpenCode CLI platform tarball from npm and stages the
// executable next to the app. Same artifact OpenCode's own installer uses.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const version = String(pkg.opencodeCli?.version || '').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`packages/desktop/package.json opencodeCli.version must be exact, got: ${version || '(missing)'}`);
}

const artifact = process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64-baseline';
const url = `https://registry.npmjs.org/@opencode/cli-${artifact}/-/cli-${artifact}-${version}.tgz`;
const cacheDir = path.join(desktopRoot, '.cache', 'opencode-cli');
const extractDir = path.join(cacheDir, version);
const targetDir = path.join(desktopRoot, 'src-tauri', 'resources', 'opencode-cli');
const targetBinary = path.join(targetDir, 'opencode.exe');

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(targetDir, { recursive: true });

if (!fs.existsSync(targetBinary)) {
  const archive = path.join(cacheDir, `cli-${artifact}-${version}.tgz`);
  if (!fs.existsSync(archive)) {
    console.log(`[desktop] downloading OpenCode CLI ${version}: ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const tar = spawnSync('tar', ['-xzf', archive, '-C', extractDir], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`extract failed with exit ${tar.status}`);
  const binary = path.join(extractDir, 'package', 'bin', 'opencode.exe');
  if (!fs.existsSync(binary)) throw new Error(`opencode.exe missing from the package: ${binary}`);
  fs.copyFileSync(binary, targetBinary);
}

const check = spawnSync(targetBinary, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
const reported = `${check.stdout || ''}${check.stderr || ''}`.trim();
if (check.status !== 0 || !reported.includes(version)) {
  throw new Error(`staged OpenCode CLI does not report ${version}: ${reported || `exit ${check.status}`}`);
}
console.log(`[desktop] OpenCode CLI ${version}: ${targetBinary} (${reported.split('\n')[0]})`);
