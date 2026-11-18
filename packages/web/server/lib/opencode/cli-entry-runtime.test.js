import { describe, expect, it, vi } from 'vitest';
import { runCliEntryIfMain } from './cli-entry-runtime.js';

const baseDependencies = (argv) => ({
  process: { argv },
  currentFilename: 'C:\\app\\server\\index.js',
  parseServeCliOptions: () => ({ port: 4000, host: '127.0.0.1' }),
  defaultPort: 3000,
  cloudflareProvider: 'cloudflare',
  managedLocalMode: 'managed-local',
  setExitOnShutdown: () => {},
  startServer: vi.fn(() => ({ catch: () => {} })),
});

describe('runCliEntryIfMain', () => {
  it('starts the server when argv[1] is the source entry', () => {
    const dependencies = baseDependencies(['bun', 'C:\\app\\server\\index.js', 'serve']);
    runCliEntryIfMain(dependencies);
    expect(dependencies.startServer).toHaveBeenCalledTimes(1);
  });

  it('starts the server from a compiled binary whose entry is the bundled main', () => {
    const dependencies = {
      ...baseDependencies(['bun', 'B:/~BUN/root/spleen-server.exe', 'serve']),
      mainModule: 'B:/~BUN/root/spleen-server.exe',
    };
    runCliEntryIfMain(dependencies);
    expect(dependencies.startServer).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the file is imported by another entry', () => {
    const dependencies = { ...baseDependencies(['bun', 'C:\\app\\test.js']), mainModule: 'C:/app/test.js' };
    runCliEntryIfMain(dependencies);
    expect(dependencies.startServer).not.toHaveBeenCalled();
  });
});
