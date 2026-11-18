// Stages the built web UI into the Tauri resource directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const source = path.join(repoRoot, 'packages', 'web', 'dist');
const target = path.join(desktopRoot, 'src-tauri', 'resources', 'web-dist');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error(`build the web UI first: ${source} has no index.html`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
const count = fs.readdirSync(target, { recursive: true }).length;
console.log(`[desktop] web assets: ${target} (${count} entries)`);

// The server reads these at runtime; a compiled binary has no source tree beside it.
const builtinsSource = path.join(repoRoot, 'packages', 'web', 'server', 'built-in-extensions');
const builtinsTarget = path.join(desktopRoot, 'src-tauri', 'resources', 'built-in-extensions');
fs.rmSync(builtinsTarget, { recursive: true, force: true });
fs.cpSync(builtinsSource, builtinsTarget, { recursive: true });
console.log(`[desktop] built-in extensions: ${builtinsTarget}`);
