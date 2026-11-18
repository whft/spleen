// Full desktop staging: web UI assets, sidecar binary, pinned OpenCode CLI.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const run = (script) => {
  const result = spawnSync(process.execPath, [path.join(here, script)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit ${result.status}`);
};

run('stage-web-assets.mjs');
run('build-sidecar.mjs');
run('prepare-opencode-cli.mjs');
