import { describe, expect, it } from 'vitest';

import { INJECTED_ENV_KEY, assignInjectedEnv, injectedEnvKeys, withUserEnv, withoutInjectedEnv } from './injected-env.js';

describe('assignInjectedEnv', () => {
  it('sets the values and records their names', () => {
    const env = { PATH: '/usr/bin' };

    expect(assignInjectedEnv(env, { SPLEEN_RUNTIME: 'desktop', SPLEEN_DESKTOP_NOTIFY: 'true' })).toBe(env);

    expect(env).toEqual({
      PATH: '/usr/bin',
      SPLEEN_RUNTIME: 'desktop',
      SPLEEN_DESKTOP_NOTIFY: 'true',
      [INJECTED_ENV_KEY]: 'SPLEEN_RUNTIME,SPLEEN_DESKTOP_NOTIFY',
    });
    expect(injectedEnvKeys(env)).toEqual(new Set(['SPLEEN_RUNTIME', 'SPLEEN_DESKTOP_NOTIFY', INJECTED_ENV_KEY]));
  });

  it('leaves a value the shell already had as the user\'s', () => {
    const env = { OPENCODE_PASSWORD: 'theirs', SPLEEN_SKIP_API_COMPRESSION: 'false' };

    assignInjectedEnv(env, {
      OPENCODE_PASSWORD: 'theirs',
      OPENCODE_SERVER_PASSWORD: 'theirs',
      SPLEEN_SKIP_API_COMPRESSION: env.SPLEEN_SKIP_API_COMPRESSION || 'true',
    });

    expect(env.SPLEEN_SKIP_API_COMPRESSION).toBe('false');
    expect(injectedEnvKeys(env)).toEqual(new Set(['OPENCODE_SERVER_PASSWORD', INJECTED_ENV_KEY]));
  });

  it('adds to a record inherited from the parent process', () => {
    const env = assignInjectedEnv({}, { SPLEEN_RUNTIME: 'desktop' });
    const child = assignInjectedEnv({ ...env }, { OPENCODE_CONFIG: '/tmp/opencode.json', SPLEEN_RUNTIME: 'desktop' });

    expect(child[INJECTED_ENV_KEY]).toBe('SPLEEN_RUNTIME,OPENCODE_CONFIG');
    expect(env[INJECTED_ENV_KEY]).toBe('SPLEEN_RUNTIME');
  });

  it('skips undefined values and writes no record when nothing changed', () => {
    const env = { SPLEEN_HOST: '0.0.0.0' };

    assignInjectedEnv(env, { SPLEEN_UI_PASSWORD: undefined, SPLEEN_HOST: '0.0.0.0' });

    expect(env).toEqual({ SPLEEN_HOST: '0.0.0.0' });
    expect(injectedEnvKeys(env).size).toBe(0);
  });
});

describe('injectedEnvKeys', () => {
  it('ignores a malformed record', () => {
    expect(injectedEnvKeys({ [INJECTED_ENV_KEY]: '' }).size).toBe(0);
    expect(injectedEnvKeys({ [INJECTED_ENV_KEY]: ',,' })).toEqual(new Set([INJECTED_ENV_KEY]));
  });
});

describe('withoutInjectedEnv', () => {
  it('drops what Spleen put into the shell and keeps the user\'s own', () => {
    const env = assignInjectedEnv({ PATH: '/usr/bin', OPENCODE_PASSWORD: 'theirs' }, {
      SPLEEN_DIST_DIR: '/Applications/Spleen.app/web-dist',
      SPLEEN_UI_PASSWORD: 'desktop',
      OPENCODE_PASSWORD: 'theirs',
    });

    expect(withoutInjectedEnv(env)).toEqual({ PATH: '/usr/bin', OPENCODE_PASSWORD: 'theirs' });
    expect(withoutInjectedEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });
});

describe('withUserEnv', () => {
  it('hands a value over as the user\'s own, so a server started with it keeps it', () => {
    const env = assignInjectedEnv({ PATH: '/usr/bin' }, { SPLEEN_UI_PASSWORD: 'old', SPLEEN_RUNTIME: 'web' });

    const next = withUserEnv(env, { SPLEEN_UI_PASSWORD: 'kept' });

    expect(withoutInjectedEnv(next)).toEqual({ PATH: '/usr/bin', SPLEEN_UI_PASSWORD: 'kept' });
    expect(withoutInjectedEnv(withUserEnv({ A: '1' }, { B: '2' }))).toEqual({ A: '1', B: '2' });
  });
});
