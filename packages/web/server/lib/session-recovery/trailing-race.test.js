import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from './store.js';
import { createSessionRecoveryRuntime } from './runtime.js';
import { createRecoveryOpenCodeFetch } from './opencode-fetch.js';

const openStores = [];
const tempDirs = [];

const tempDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spleen-recovery-race-'));
  tempDirs.push(dir);
  return path.join(dir, 'recovery.sqlite3');
};

const openStore = (filePath) => {
  const store = createRecoveryStore({ filePath });
  openStores.push(store);
  return store;
};

afterEach(() => {
  while (openStores.length > 0) openStores.pop().close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('session-recovery trailing post-limit event race and directory normalization', () => {
  it('preserves waiting_provider and sends Continue. when OpenCode emits a trailing 4ms execution.started + execution.succeeded with directory="global"', async () => {
    const store = openStore(tempDb());
    const startAt = 1_795_435_405_884;
    const clock = { at: startAt };
    const freeLimitError = {
      type: 'provider.free-limit',
      message: 'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
      status: 429,
    };
    const seenDirectories = [];
    const prompts = [];

    const sessionInfo = {
      id: 'ses_race_zen',
      directory: 'C:/work/demo',
      outcome: 'succeeded',
      model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
      time: { created: startAt - 60_000, updated: startAt + 6 },
    };
    const messages = [
      { id: 'u1', type: 'user', text: 'finish the injector refactor' },
      {
        id: 'a1',
        type: 'assistant',
        model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
        content: [{ type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed' }, executed: true }],
        time: { created: startAt - 5_000, completed: startAt - 1_000 },
        finish: 'tool-calls',
      },
      {
        id: 'a2',
        type: 'assistant',
        model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
        content: [],
        error: freeLimitError,
        time: { created: startAt, completed: startAt },
        finish: 'error',
      },
    ];

    const openCodeFetch = async (fetchPath, options = {}) => {
      seenDirectories.push({ fetchPath, directory: options.directory ?? null });
      const method = options.method || 'GET';
      if (fetchPath === '/api/session/active') return {};
      if (fetchPath === '/api/session') return [sessionInfo];
      if (fetchPath === '/api/session/ses_race_zen') return sessionInfo;
      if (fetchPath === '/api/session/ses_race_zen/message') return { data: messages, cursor: null };
      if (method === 'POST' && fetchPath === '/api/session/ses_race_zen/prompt') {
        prompts.push({ directory: options.directory ?? null, body: options.body });
        return { id: 'inbox-continue-1' };
      }
      throw new Error(`unexpected ${method} ${fetchPath}`);
    };

    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch,
      now: () => clock.at,
      owner: 'race-test',
      pollMs: 60_000,
      startGraceMs: 0,
    });
    runtime.start();

    // 1) Initial turn runs and hits provider.free-limit (with globalEventHub directory='global')
    runtime.handleEvent({
      directory: 'global',
      payload: {
        type: 'session.execution.failed',
        durable: { seq: 685 },
        data: { sessionID: 'ses_race_zen', error: freeLimitError },
      },
    });
    expect(store.get('ses_race_zen').state).toBe('waiting_provider');
    expect(store.get('ses_race_zen').directory).toBeNull();

    // 2) +4ms later: trailing session.execution.started arrives
    clock.at = startAt + 4;
    runtime.handleEvent({
      directory: 'global',
      payload: {
        type: 'session.execution.started',
        durable: { seq: 686 },
        data: { sessionID: 'ses_race_zen' },
      },
    });
    expect(store.get('ses_race_zen').state).toBe('waiting_provider');

    // 3) +6ms later: trailing session.execution.succeeded (error: null) arrives
    clock.at = startAt + 6;
    runtime.handleEvent({
      directory: 'global',
      payload: {
        type: 'session.execution.succeeded',
        durable: { seq: 687 },
        data: { sessionID: 'ses_race_zen' },
      },
    });
    expect(store.get('ses_race_zen').state).toBe('waiting_provider');
    expect(store.get('ses_race_zen').next_wake_at).toBe(startAt + 3_000);

    // 4) At +3s wake: reconcile fetches real session directory and posts Continue.
    clock.at = startAt + 3_000;
    await runtime.reconcile();

    expect(prompts).toHaveLength(1);
    expect(prompts[0].body.text).toBe('Continue.');
    expect(prompts[0].directory).toBe('C:/work/demo');
    expect(seenDirectories.every((entry) => entry.directory !== 'global')).toBe(true);
    runtime.stop();
  });

  it('discovers and auto-continues a stopped Zen session even when previously marked completed with outcome="succeeded" after completed tools', async () => {
    const store = openStore(tempDb());
    const failedAt = 1_795_435_405_884;
    const prompts = [];

    // Simulate legacy DB row wrongly closed by a trailing execution.succeeded
    store.beginExecution({ sessionID: 'ses_masked', directory: 'global', seq: 686, at: failedAt + 4 });
    store.finish('ses_masked', 'completed', { at: failedAt + 6 });

    const sessionInfo = {
      id: 'ses_masked',
      directory: 'C:/work/demo',
      outcome: 'succeeded',
      model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
      time: { created: failedAt - 60_000, updated: failedAt + 6 },
    };
    const messages = [
      { id: 'u1', type: 'user', text: 'analyze injector.cpp' },
      {
        id: 'a1',
        type: 'assistant',
        model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
        content: [{ type: 'tool', id: 'call_read', name: 'read', state: { status: 'completed' }, executed: true }],
        time: { created: failedAt - 5_000, completed: failedAt - 1_000 },
        finish: 'tool-calls',
      },
      {
        id: 'a2',
        type: 'assistant',
        model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
        content: [{
          type: 'text',
          text: 'Opencode failed to send message with error: Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
        }],
        time: { created: failedAt, completed: failedAt },
        finish: 'stop',
      },
    ];

    const openCodeFetch = async (fetchPath, options = {}) => {
      const method = options.method || 'GET';
      if (fetchPath === '/api/session/active') return {};
      if (fetchPath === '/api/session') return [sessionInfo];
      if (fetchPath === '/api/session/ses_masked') return sessionInfo;
      if (fetchPath === '/api/session/ses_masked/message') return { data: messages, cursor: null };
      if (method === 'POST' && fetchPath === '/api/session/ses_masked/prompt') {
        prompts.push({ directory: options.directory ?? null, body: options.body });
        return { id: 'inbox-continue-2' };
      }
      throw new Error(`unexpected ${method} ${fetchPath}`);
    };

    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch,
      now: () => failedAt + 10_000,
      owner: 'masked-discovery',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();

    expect(prompts).toHaveLength(1);
    expect(prompts[0].body.text).toBe('Continue.');
    expect(prompts[0].directory).toBe('C:/work/demo');
    runtime.stop();
  });

  it('omits sentinel directory="global" in createRecoveryOpenCodeFetch query string', async () => {
    const urls = [];
    const fetchMock = async (url) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ data: {} }) };
    };
    const openCodeFetch = createRecoveryOpenCodeFetch({
      buildOpenCodeUrl: (p) => `http://127.0.0.1:4000${p}`,
      getOpenCodeAuthHeaders: () => ({}),
      fetchImpl: fetchMock,
    });

    await openCodeFetch('/api/session/s1', { directory: 'global' });
    await openCodeFetch('/api/session/s1', { directory: 'C:/work/demo' });

    expect(urls[0]).toBe('http://127.0.0.1:4000/api/session/s1');
    expect(urls[1]).toBe('http://127.0.0.1:4000/api/session/s1?directory=C%3A%2Fwork%2Fdemo');
  });
});
