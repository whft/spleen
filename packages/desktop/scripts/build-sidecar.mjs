// Compiles the Spleen web/API server into a single managed sidecar binary.
// Bun is the runtime the server is developed and tested on, so `bun build
// --compile` keeps dynamic imports and bun: built-ins working without shipping
// a node_modules tree.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const webEntry = path.join(repoRoot, 'packages', 'web', 'server', 'index.js');
const output = path.join(desktopRoot, 'src-tauri', 'binaries', 'spleen-server.exe');

const target = process.env.SPLEEN_TARGET_TRIPLE || 'x86_64-pc-windows-msvc';
const bunTarget = target === 'aarch64-pc-windows-msvc' ? 'bun-windows-arm64' : 'bun-windows-x64';

if (!fs.existsSync(webEntry)) {
  throw new Error(`web server entry not found: ${webEntry}`);
}
fs.mkdirSync(path.dirname(output), { recursive: true });

const result = spawnSync(
  process.env.SPLEEN_BUN || 'bun',
  ['build', '--compile', webEntry, '--outfile', output, '--target', bunTarget],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`sidecar build failed with exit ${result.status}`);

const bytes = fs.statSync(output).size;
if (bytes < 10 * 1024 * 1024) throw new Error(`sidecar looks truncated: ${bytes} bytes`);
console.log(`[desktop] sidecar: ${output} (${(bytes / 1024 / 1024).toFixed(1)} MiB)`);
