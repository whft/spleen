import { describe, expect, it } from 'vitest';

import { createDevServerWatchCommand } from './dev-server-watch.mjs';

describe('createDevServerWatchCommand', () => {
  it('preserves the injected desktop dev data directory for the HMR server', () => {
    const command = createDevServerWatchCommand({
      platform: 'linux', bunExecutable: 'bun',
      env: {
        SPLEEN_DESKTOP_DEV: '1',
        SPLEEN_DATA_DIR: '/dev-data',
        SPLEEN_DESKTOP_DEV_DATA_DIR: '/dev-data',
        SPLEEN_INJECTED_ENV: 'SPLEEN_DATA_DIR,SPLEEN_UI_PASSWORD',
        SPLEEN_UI_PASSWORD: 'secret',
      },
    });
    expect(command.spawnOptions.env.SPLEEN_DATA_DIR).toBe('/dev-data');
    expect(command.spawnOptions.env.SPLEEN_INJECTED_ENV).toBe('SPLEEN_DATA_DIR');
    expect(command.spawnOptions.env.SPLEEN_UI_PASSWORD).toBeUndefined();
    expect(command.spawnOptions.env.SPLEEN_DESKTOP_DEV_DATA_DIR).toBeUndefined();
  });

  it('retains an explicitly supplied desktop data directory without marking it injected', () => {
    const command = createDevServerWatchCommand({
      platform: 'linux', bunExecutable: 'bun',
      env: {
        SPLEEN_DESKTOP_DEV: '1',
        SPLEEN_DATA_DIR: '/custom',
        SPLEEN_DESKTOP_DEV_DATA_DIR: '/custom',
      },
    });
    expect(command.spawnOptions.env.SPLEEN_DATA_DIR).toBe('/custom');
    expect(command.spawnOptions.env.SPLEEN_INJECTED_ENV).toBeUndefined();
    expect(command.spawnOptions.env.SPLEEN_DESKTOP_DEV_DATA_DIR).toBeUndefined();
  });
  it('uses the package default port and disables relay hosting by default', () => {
    const command = createDevServerWatchCommand({
      platform: 'win32',
      env: {},
      bunExecutable: '/opt/bun/bin/bun',
    });

    expect(command.command).toBe('/opt/bun/bin/bun');
    expect(command.args).toEqual(['--watch', 'server/index.js', '--port', '3001']);
    expect(command.spawnOptions.env.SPLEEN_RELAY_HOST).toBe('off');
    expect(command.spawnOptions.windowsHide).toBe(true);
  });

  it('passes the configured port and relay host to the Bun watcher', () => {
    const command = createDevServerWatchCommand({
      platform: 'win32',
      env: {
        SPLEEN_PORT: '58992',
        SPLEEN_RELAY_HOST: 'relay.example.test',
      },
      bunExecutable: 'C:\\Tools\\Bun\\bun.exe',
    });

    expect(command.args).toEqual(['--watch', 'server/index.js', '--port', '58992']);
    expect(command.spawnOptions.env.SPLEEN_RELAY_HOST).toBe('relay.example.test');
  });

  it('rejects an invalid configured port before spawning', () => {
    expect(() => createDevServerWatchCommand({
      platform: 'win32',
      env: { SPLEEN_PORT: 'not-a-port' },
      bunExecutable: 'bun',
    })).toThrow(/Invalid SPLEEN_PORT/);
  });

  it('preserves the nodemon watcher command outside Windows', () => {
    const command = createDevServerWatchCommand({
      platform: 'linux',
      env: { SPLEEN_PORT: '4200' },
      bunExecutable: '/opt/bun/bin/bun',
    });

    expect(command.command).toBe('/opt/bun/bin/bun');
    expect(command.args).toEqual([
      'x',
      'nodemon',
      '--watch',
      'server',
      '--ext',
      'js',
      '--exec',
      'bun server/index.js --port 4200',
    ]);
  });

  it('drops what an Spleen app put into the shell and keeps the user\'s own exports', () => {
    const command = createDevServerWatchCommand({
      platform: 'linux',
      env: {
        PATH: '/usr/bin',
        SPLEEN_PORT: '4200',
        SPLEEN_UI_PASSWORD: 'desktop-secret',
        SPLEEN_RUNTIME: 'desktop',
        OPENCODE_PASSWORD: 'theirs',
        SPLEEN_INJECTED_ENV: 'SPLEEN_UI_PASSWORD,SPLEEN_RUNTIME',
      },
      bunExecutable: 'bun',
    });

    const { env } = command.spawnOptions;
    expect(env).not.toHaveProperty('SPLEEN_UI_PASSWORD');
    expect(env).not.toHaveProperty('SPLEEN_RUNTIME');
    expect(env).not.toHaveProperty('SPLEEN_INJECTED_ENV');
    expect(env).toMatchObject({ PATH: '/usr/bin', SPLEEN_PORT: '4200', OPENCODE_PASSWORD: 'theirs' });
  });
});
