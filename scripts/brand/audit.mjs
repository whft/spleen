// Brand gate: no inherited product identity in tracked paths or text files.
// Historical attribution is allowed only where the allowlist names the file.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowlistPath = path.join(root, 'scripts', 'brand', 'allowlist.json');
const allowlist = fs.existsSync(allowlistPath) ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8')) : [];
const pattern = /open[-_ ]?chamber/i;
const maxBytes = 2 * 1024 * 1024;

const globToRegExp = (glob) => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
};
const allowed = (file) => allowlist.some((entry) => globToRegExp(entry.glob).test(file));

const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (listed.error || listed.status !== 0) {
  console.error('brand-audit: git ls-files failed; run inside the repository');
  process.exit(2);
}
const files = listed.stdout.split('\0').filter(Boolean);

const violations = [];
for (const file of files) {
  if (allowed(file)) continue;
  if (pattern.test(file)) {
    violations.push(`${file}: path contains an inherited product name`);
    continue;
  }
  const absolute = path.join(root, file);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > maxBytes) continue;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString('utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) violations.push(`${file}:${index + 1}: ${lines[index].trim().slice(0, 160)}`);
  }
}

if (violations.length > 0) {
  console.error(`brand-audit: ${violations.length} inherited identity reference(s):`);
  for (const violation of violations.slice(0, 100)) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(`brand-audit: ${files.length} tracked files clean`);
