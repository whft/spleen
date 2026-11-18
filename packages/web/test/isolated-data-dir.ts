import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Every test file starts with its own empty Spleen data directory. The
// server modules resolve `SPLEEN_DATA_DIR` when they load and fall back
// to ~/.config/spleen, so a file that imports one before choosing a
// directory read the developer's real settings and wrote their auth store
// (it rewrote a real source-control-auth.json once). Suites that need a
// specific directory still set their own.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spleen-test-data-'));
process.env.SPLEEN_DATA_DIR = dataDir;

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
