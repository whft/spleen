import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionRecoveryRuntime } from './runtime.js';
import { buildResumePrompt, decideRecovery, summarizeTail } from './reconciler.js';
import { createRecoveryStore } from './store.js';

const tempDirs = [];
const stores = [];

const tempDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spleen-recovery-'));
  tempDirs.push(dir);
  return path.join(dir, 'recovery.sqlite3');
};

const openStore = (filePath) => {
  const store = createRecoveryStore({ filePath });
  stores.push(store);
  return store;
};

const userMessage = (id, text, metadata = undefined) => ({
  id,
  type: 'user',
  text,
  ...(metadata ? { metadata } : {}),
  time: { created: 1 },
});

const assistantMessage = (id, tools = [], { completed = false, completedAt = 2, error = null } = {}) => ({
  id,
  type: 'assistant',
  content: tools.map((tool) => ({
    type: 'tool',
    id: tool.id,
    name: tool.name,
    executed: tool.executed !== false,
    state: { status: tool.status, input: tool.input ?? {} },
  })),
  ...(error ? { error } : null),
  time: completed ? { created: 1, completed: completedAt } : { created: 1 },
});

const fakeBackend = ({ sessions, active = {}, promptError = null }) => {
  const prompts = [];
  const fetchImpl = async (fetchPath, options = {}) => {
    const method = options.method || 'GET';
    if (fetchPath === '/api/session/active') return active;
    const promptMatch = fetchPath.match(/^\/api\/session\/([^/]+)\/prompt$/);
    if (method === 'POST' && promptMatch) {
      if (promptError) throw promptError;
      const sessionID = decodeURIComponent(promptMatch[1]);
      prompts.push({ sessionID, body: options.body });
      return { id: `inbox-${prompts.length}` };
    }
    const messageMatch = fetchPath.match(/^\/api\/session\/([^/]+)\/message$/);
    if (messageMatch) {
      const sessionID = decodeURIComponent(messageMatch[1]);
      const entry = sessions.get(sessionID);
      if (!entry) throw Object.assign(new Error('not found'), { status: 404 });
      return { data: entry.messages, cursor: null };
    }
    const sessionMatch = fetchPath.match(/^\/api\/session\/([^/]+)$/);
    if (sessionMatch) {
      const sessionID = decodeURIComponent(sessionMatch[1]);
      const entry = sessions.get(sessionID);
      if (!entry) throw Object.assign(new Error('not found'), { status: 404 });
      return entry.info;
    }
    throw new Error(`unexpected request ${method} ${fetchPath}`);
  };
  return { prompts, fetchImpl, sessions, active };
};

const seedInterruptedSessions = (count) => {
  const sessions = new Map();
  for (let index = 0; index < count; index += 1) {
    const sessionID = `ses_root${index}`;
    sessions.set(sessionID, {
      info: { id: sessionID, outcome: 'interrupted', time: { created: 1, updated: 2 } },
      messages: [
        userMessage(`msg_user${index}`, `finish task ${index}`),
        assistantMessage(`msg_assistant${index}`, [
          { id: `tool_done${index}`, name: 'bash', status: 'completed' },
          { id: `tool_open${index}`, name: 'edit', status: 'running' },
        ]),
      ],
    });
    const childID = `ses_child${index}`;
    sessions.set(childID, {
      info: { id: childID, parentID: sessionID, outcome: 'interrupted', time: { created: 1, updated: 2 } },
      messages: [userMessage(`msg_child_user${index}`, 'child work'), assistantMessage(`msg_child_a${index}`, [])],
    });
  }
  return sessions;
};

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // closed by the test
    }
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('decideRecovery', () => {
  const row = { started_at: 0, attempts: 0, next_wake_at: null, state: 'running' };
  const interrupted = { id: 'ses_x', outcome: 'interrupted' };
  const pendingMessages = [
    userMessage('u1', 'do work'),
    assistantMessage('a1', [{ id: 't1', name: 'bash', status: 'running' }]),
  ];

  it('attaches to a turn the backend still owns', () => {
    expect(decideRecovery({ row, active: true, session: interrupted, messages: pendingMessages }).action).toBe('attach');
  });

  it('completes when the transcript has no unfinished turn', () => {
    const completedMessages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [{ id: 't1', name: 'bash', status: 'completed' }], { completed: true }),
    ];
    expect(decideRecovery({ row, session: { id: 'ses_x', outcome: 'succeeded' }, messages: completedMessages }).state).toBe('completed');
    expect(decideRecovery({ row, session: { id: 'ses_x', outcome: 'failed' }, messages: completedMessages }).state).toBe('failed');
  });

  it('parks a completed turn a usage limit stopped, then resumes it after the reset', () => {
    const failedAt = 5_000;
    const error = {
      type: 'provider.go-limit',
      message: 'OpenCode Go 5 hour usage limit reached.',
      status: 429,
      retryAfterMs: 60_000,
    };
    const messages = [userMessage('u1', 'do work'), assistantMessage('a1', [], { completed: true, completedAt: failedAt, error })];
    const session = { id: 'ses_x', outcome: 'failed' };
    const parked = decideRecovery({ row, session, messages, now: failedAt });
    expect(parked).toMatchObject({ action: 'park', state: 'waiting_provider', nextWakeAt: failedAt + 60_000 });

    const waiting = { ...row, state: 'waiting_provider', next_wake_at: failedAt + 60_000 };
    expect(decideRecovery({ row: waiting, session, messages, now: failedAt + 59_000 })).toMatchObject({ action: 'wait', state: 'waiting_provider' });
    expect(decideRecovery({ row: waiting, session, messages, now: failedAt + 60_000 })).toMatchObject({
      action: 'resume',
      attempt: 0,
      afterLimit: true,
    });
  });

  it('continues after a reset even when the crash budget is spent', () => {
    const messages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [], {
        completed: true,
        completedAt: 1,
        error: { type: 'provider.quota', message: 'usage limit reached', status: 429, retryAfterMs: 500 },
      }),
    ];
    const waiting = { ...row, state: 'waiting_provider', attempts: 2, next_wake_at: 501 };
    const decision = decideRecovery({ row: waiting, session: { id: 'ses_x', outcome: 'failed' }, messages, now: 501 });
    expect(decision).toMatchObject({ action: 'resume', afterLimit: true, attempt: 2 });
  });

  it('probes a seven-day reset instead of resuming early', () => {
    const resetMs = 7 * 24 * 60 * 60_000;
    const messages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [], {
        completed: true,
        completedAt: 1_000,
        error: { type: 'provider.quota', message: 'usage limit reached', status: 429, retryAfterMs: resetMs },
      }),
    ];
    const waiting = { ...row, state: 'waiting_provider', next_wake_at: 2_000 };
    const decision = decideRecovery({ row: waiting, session: { id: 'ses_x', outcome: 'failed' }, messages, now: 3_000 });
    expect(decision).toMatchObject({ action: 'wait', state: 'waiting_provider', nextWakeAt: 1_000 + 5 * 60_000 });
  });

  it('never retries a short reset sooner than the limit backoff', () => {
    const messages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [], {
        completed: true,
        completedAt: 1_000,
        error: { type: 'provider.quota', message: 'usage limit reached', status: 429, retryAfterMs: 300_000 },
      }),
    ];
    const waiting = { ...row, state: 'waiting_provider', provider_waits: 1, next_wake_at: 301_000 };
    const decision = decideRecovery({ row: waiting, session: { id: 'ses_x', outcome: 'failed' }, messages, now: 301_000 });
    expect(decision).toMatchObject({ action: 'wait', state: 'waiting_provider', nextWakeAt: 1_000 + 60 * 60_000 });
  });

  it('waits out an accepted continuation that is not in the transcript yet', () => {
    const messages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [], {
        completed: true,
        completedAt: 1_000,
        error: { type: 'provider.quota', message: 'usage limit reached', status: 429, retryAfterMs: 5_000 },
      }),
    ];
    const sent = { ...row, state: 'recovering', provider_waits: 1, resumed_at: 30_000, resume_message_id: 'inbox-1' };
    const session = { id: 'ses_x', outcome: 'failed' };
    expect(decideRecovery({ row: sent, session, messages, now: 31_000 })).toMatchObject({
      action: 'wait',
      state: 'recovering',
      nextWakeAt: 61_000,
    });
    expect(decideRecovery({ row: sent, session, messages, now: 30_000 + 10 * 60_000 + 1 })).toMatchObject({
      action: 'needs_review',
      reason: 'resume delivered but not in transcript',
    });
  });

  it('measures the resume settle window from the resume, not the first start', () => {
    const messages = [
      userMessage('u1', 'do work'),
      userMessage('r1', 'Continue.', { spleenRecovery: { sessionID: 'ses_x', executionSeq: 1, attempt: 0 } }),
    ];
    const sent = { ...row, started_at: 1, state: 'recovering', resumed_at: 50_000 };
    expect(decideRecovery({ row: sent, session: interrupted, messages, now: 51_000 })).toMatchObject({
      action: 'wait',
      state: 'recovering',
      nextWakeAt: 81_000,
    });
    expect(decideRecovery({ row: sent, session: interrupted, messages, now: 50_000 + 10 * 60_000 + 1 }).action).toBe('needs_review');
  });

  it('quickly continues a free-limit stop in 3s even when retryAfterMs is hours away, and escalates if immediate retry hits limit again', () => {
    const messages = [
      userMessage('u1', 'do work'),
      {
        ...assistantMessage('a1', [], {
          completed: true,
          completedAt: 1_000,
          error: {
            type: 'provider.free-limit',
            message: 'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
            status: 429,
            retryAfterMs: 75_982_000,
          },
        }),
        model: { id: 'deepseek-v4.1-flash-free', providerID: 'opencode', variant: 'max' },
      },
    ];
    const session = { id: 'ses_x', outcome: 'failed' };
    expect(decideRecovery({ row, session, messages, now: 1_000 })).toMatchObject({
      action: 'park',
      nextWakeAt: 1_000 + 3_000,
    });
    expect(decideRecovery({ row: { ...row, provider_waits: 1 }, session, messages, now: 4_000 })).toMatchObject({
      action: 'park',
      nextWakeAt: 1_000 + 15_000,
    });
    expect(decideRecovery({ row: { ...row, provider_waits: 2 }, session, messages, now: 19_000 })).toMatchObject({
      action: 'park',
      nextWakeAt: 1_000 + 60_000,
    });
  });

  it('backs off an hour, then doubles, when a quota names no reset', () => {
    const messages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [], {
        completed: true,
        completedAt: 1_000,
        error: { type: 'provider.quota', message: 'usage limit reached', status: 429 },
      }),
    ];
    const session = { id: 'ses_x', outcome: 'failed' };
    expect(decideRecovery({ row, session, messages, now: 2_000 }).nextWakeAt).toBe(1_000 + 60 * 60_000);
    expect(decideRecovery({ row: { ...row, provider_waits: 2 }, session, messages, now: 2_000 }).nextWakeAt).toBe(1_000 + 2 * 60 * 60_000);
  });

  it('waits out a rate limit that already outlived OpenCode retries', () => {
    const messages = [
      userMessage('u1', 'do work'),
      assistantMessage('a1', [], {
        completed: true,
        completedAt: 1_000,
        error: { type: 'provider.rate-limit', message: 'slow down', status: 429, retryAfterMs: 8_000 },
      }),
    ];
    const decision = decideRecovery({ row, session: { id: 'ses_x', outcome: 'failed' }, messages, now: 2_000 });
    expect(decision).toMatchObject({ action: 'park', state: 'waiting_provider', nextWakeAt: 1_000 + 60 * 60_000 });
  });

  it('trusts an unfinished transcript over a stale succeeded outcome', () => {
    const decision = decideRecovery({ row, session: { id: 'ses_x', outcome: 'succeeded' }, messages: pendingMessages, now: 10 });
    expect(decision.action).toBe('resume');
  });

  it('resumes an interrupted turn inside its retry budget', () => {
    const decision = decideRecovery({ row, session: interrupted, messages: pendingMessages, now: 10 });
    expect(decision).toMatchObject({ action: 'resume', attempt: 1 });
    expect(decision.tail.unknownTools).toHaveLength(1);
  });

  it('never resumes past the attempt budget', () => {
    const decision = decideRecovery({ row: { ...row, attempts: 2 }, session: interrupted, messages: pendingMessages });
    expect(decision).toMatchObject({ action: 'needs_review', state: 'needs_review' });
  });

  it('does not resend a resume that is already in the transcript', () => {
    const messages = [
      userMessage('u2', 'continue', { spleenRecovery: { sessionID: 'ses_x', attempt: 1 } }),
    ];
    const decision = decideRecovery({ row: { ...row, attempts: 1 }, session: interrupted, messages, now: 0 });
    expect(decision).toMatchObject({ action: 'wait', state: 'recovering' });
  });

  it('marks a missing session for review', () => {
    expect(decideRecovery({ row, session: null, messages: null }).state).toBe('needs_review');
  });
});

describe('summarizeTail', () => {
  it('separates completed and unknown tool outcomes', () => {
    const tail = summarizeTail([
      userMessage('u1', 'go'),
      assistantMessage('a1', [
        { id: 't1', name: 'bash', status: 'completed' },
        { id: 't2', name: 'edit', status: 'running' },
        { id: 't3', name: 'read', status: 'called', executed: false },
      ]),
    ]);
    expect(tail.pending).toBe(true);
    expect(tail.completedTools.map((tool) => tool.id)).toEqual(['t1']);
    expect(tail.unknownTools.map((tool) => tool.id)).toEqual(['t2']);
  });
});

describe('buildResumePrompt', () => {
  it('reads as a plain continue', () => {
    const prompt = buildResumePrompt({ sessionID: 'ses_x', executionSeq: 4, attempt: 1 });
    expect(prompt.text).toBe('Continue.');
    expect(prompt.metadata.spleenRecovery).toMatchObject({ sessionID: 'ses_x', executionSeq: 4, attempt: 1 });
  });
});

describe('recovery runtime', () => {
  it('resumes ten crashed chats once each and defers their children', async () => {
    const dbPath = tempDb();
    const sessions = seedInterruptedSessions(10);

    const first = openStore(dbPath);
    for (let index = 0; index < 10; index += 1) {
      first.beginExecution({ sessionID: `ses_root${index}`, directory: `C:/work/${index}`, seq: 1, at: 1 });
      first.noteTool({ sessionID: `ses_root${index}`, toolID: `tool_done${index}`, name: 'bash', status: 'completed', executed: true, at: 1 });
      first.beginExecution({ sessionID: `ses_child${index}`, parentSessionID: `ses_root${index}`, directory: `C:/work/${index}`, seq: 1, at: 1 });
    }
    const backend = fakeBackend({ sessions });
    const clock = { at: 1_000 };
    const runtime = createSessionRecoveryRuntime({
      store: first,
      openCodeFetch: backend.fetchImpl,
      now: () => clock.at,
      owner: 'first',
      resumeConcurrency: 3,
      startGraceMs: 0,
    });
    expect(runtime.start().hasLease).toBe(true);
    await runtime.reconcile();
    expect(backend.prompts).toHaveLength(10);
    expect(backend.prompts.every((prompt) => prompt.body.metadata.spleenRecovery.attempt === 1)).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      expect(first.get(`ses_root${index}`).state).toBe('recovering');
      expect(first.get(`ses_child${index}`).state).toBe('waiting_parent');
    }

    // A second pass inside the settle window must not send anything again.
    await runtime.reconcile();
    expect(backend.prompts).toHaveLength(10);
    runtime.stop();

    // Crash: reopen the ledger, a new coordinator resumes nothing that is waiting.
    const second = openStore(dbPath);
    const backendAfterRestart = fakeBackend({ sessions });
    const restartClock = { at: 1_000 + 5_000 };
    const restarted = createSessionRecoveryRuntime({
      store: second,
      openCodeFetch: backendAfterRestart.fetchImpl,
      now: () => restartClock.at,
      owner: 'second',
    });
    restarted.start();
    await restarted.reconcile();
    expect(backendAfterRestart.prompts).toHaveLength(0);
    restarted.stop();
  });

  it('parks a provider limit without spending the retry budget', async () => {
    const dbPath = tempDb();
    const sessions = seedInterruptedSessions(1);
    const store = openStore(dbPath);
    store.beginExecution({ sessionID: 'ses_root0', seq: 1, at: 1 });
    const limitError = Object.assign(new Error('prompt failed (429): usage limit reached'), { status: 429 });
    const backend = fakeBackend({ sessions, promptError: limitError });
    const clock = { at: 10_000 };
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => clock.at,
      owner: 'limits',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    const row = store.get('ses_root0');
    expect(row.state).toBe('waiting_provider');
    expect(row.attempts).toBe(1);
    expect(row.next_wake_at).toBeGreaterThan(clock.at);
    runtime.stop();
  });

  it('parks an execution stopped by a usage limit until its reset', () => {
    const store = openStore(tempDb());
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 1, at: 1_000 });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: async () => { throw new Error('no backend calls in this case'); },
      now: () => 10_000,
      owner: 'limit-event',
    });
    runtime.handleEvent({
      type: 'session.execution.failed',
      data: {
        sessionID: 'ses_limit',
        error: { type: 'provider.quota', message: 'usage limit reached', status: 429, retryAfterMs: 120_000 },
      },
    });
    const row = store.get('ses_limit');
    expect(row.state).toBe('waiting_provider');
    expect(row.next_wake_at).toBe(130_000);
    expect(row.attempts).toBe(0);
    runtime.stop();
  });

  it('schedules a fast 3s auto-continue on OpenCode Zen free limit and resets backoff after real tool progress', () => {
    const store = openStore(tempDb());
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 1, at: 1_000 });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: async () => { throw new Error('no backend calls in this case'); },
      now: () => 10_000,
      owner: 'limit-probe',
    });
    runtime.handleEvent({
      type: 'session.execution.failed',
      data: {
        sessionID: 'ses_limit',
        model: { id: 'deepseek-v4.1-flash-free', providerID: 'opencode', variant: 'max' },
        error: { type: 'provider.free-limit', message: 'Free usage limit reached.', status: 429, retryAfterMs: 75_982_000 },
      },
    });
    const row = store.get('ses_limit');
    expect(row.state).toBe('waiting_provider');
    expect(row.next_wake_at).toBe(10_000 + 3_000);

    // Simulate a continuation that succeeds and completes a real tool call: provider_waits resets to 0
    store.schedule('ses_limit', { state: 'recovering', attempts: 0, providerWaits: 2, resumedAt: 13_000, at: 13_000 });
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 2, at: 14_000 });
    expect(store.get('ses_limit').provider_waits).toBe(2);
    store.noteTool({ sessionID: 'ses_limit', toolID: 'tool_1', name: 'read', status: 'completed', executed: true, at: 15_000 });
    expect(store.get('ses_limit').provider_waits).toBe(0);
    runtime.stop();
  });

  it('continues a chat after its usage reset even though the failed turn is complete', async () => {
    const store = openStore(tempDb());
    const limitError = { type: 'provider.quota', message: 'usage limit reached', status: 429 };
    const sessions = new Map([['ses_limit', {
      info: { id: 'ses_limit', outcome: 'failed', time: { created: 1, updated: 2 } },
      messages: [
        userMessage('u1', 'finish the feature'),
        assistantMessage('a1', [{ id: 't1', name: 'bash', status: 'completed' }], {
          completed: true,
          completedAt: 1_000,
          error: limitError,
        }),
      ],
    }]]);
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 1, at: 500 });
    store.schedule('ses_limit', { state: 'waiting_provider', attempts: 0, nextWakeAt: 2_000, error: 'provider limit', at: 600 });
    const backend = fakeBackend({ sessions });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 3_602_000,
      owner: 'limit-resume',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    expect(backend.prompts).toHaveLength(1);
    expect(backend.prompts[0].body.text).toBe('Continue.');
    expect(backend.prompts[0].body.metadata.spleenRecovery.attempt).toBe(0);
    expect(store.get('ses_limit').state).toBe('recovering');
    runtime.stop();
  });

  it('counts a 429 on the continuation prompt as a provider wait', async () => {
    const store = openStore(tempDb());
    const limitError = { type: 'provider.quota', message: 'usage limit reached', status: 429, retryAfterMs: 5_000 };
    const sessions = new Map([['ses_limit', {
      info: { id: 'ses_limit', outcome: 'interrupted', time: { created: 1, updated: 2 } },
      messages: [
        userMessage('u1', 'finish the feature'),
        assistantMessage('a1', [], { completed: true, completedAt: 1_000, error: limitError }),
      ],
    }]]);
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 1, at: 500 });
    store.schedule('ses_limit', { state: 'waiting_provider', attempts: 0, nextWakeAt: 6_000, error: 'provider limit', at: 1_000 });
    const promptError = Object.assign(new Error('slow down'), {
      type: 'provider.rate-limit',
      status: 429,
      retryAfterMs: 5_000,
    });
    const backend = fakeBackend({ sessions, promptError });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 6_000,
      owner: 'limit-send',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    const row = store.get('ses_limit');
    expect(row.state).toBe('waiting_provider');
    expect(row.provider_waits).toBe(1);
    expect(row.next_wake_at).toBe(6_000 + 60 * 60_000);
    runtime.stop();
  });

  it('revives a chat an earlier build marked failed by a usage limit', async () => {
    const store = openStore(tempDb());
    const limitError = { type: 'provider.quota', message: 'usage limit reached', status: 429 };
    const sessions = new Map([['ses_limit', {
      info: { id: 'ses_limit', outcome: 'failed', time: { created: 1, updated: 2 } },
      messages: [
        userMessage('u1', 'finish the feature'),
        assistantMessage('a1', [], { completed: true, completedAt: 1_000, error: limitError }),
      ],
    }]]);
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 1, at: 500 });
    store.finish('ses_limit', 'failed', { at: 2_000, error: 'provider.quota' });
    const backend = fakeBackend({ sessions });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 3_602_000,
      owner: 'limit-revive',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    expect(backend.prompts).toHaveLength(1);
    expect(backend.prompts[0].body.metadata.spleenRecovery.attempt).toBe(0);
    runtime.stop();
  });

  it('keeps a parked chat when the backend cannot be read yet', async () => {
    const store = openStore(tempDb());
    store.beginExecution({ sessionID: 'ses_limit', directory: 'C:/work', seq: 1, at: 1 });
    store.schedule('ses_limit', { state: 'waiting_provider', attempts: 0, nextWakeAt: 2_000, error: 'provider limit', at: 600 });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: async (fetchPath) => {
        if (fetchPath === '/api/session/active') return {};
        throw Object.assign(new Error('bad gateway'), { status: 502 });
      },
      now: () => 3_000,
      owner: 'limit-transient',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    const row = store.get('ses_limit');
    expect(row.state).toBe('waiting_provider');
    expect(row.next_wake_at).toBe(2_000);
    runtime.stop();
  });

  it('leaves an actively running child attached to its parent', async () => {
    const store = openStore(tempDb());
    const sessions = new Map([
      ['ses_child', {
        info: { id: 'ses_child', parentID: 'ses_parent', outcome: 'interrupted', time: { created: 1, updated: 2 } },
        messages: [userMessage('cu', 'child work'), assistantMessage('ca', [{ id: 'c1', name: 'bash', status: 'running' }])],
      }],
    ]);
    store.beginExecution({ sessionID: 'ses_parent', directory: 'C:/work', seq: 1, at: 1 });
    store.beginExecution({ sessionID: 'ses_child', directory: 'C:/work', seq: 1, at: 1 });
    store.noteParent('ses_child', 'ses_parent', 1);
    store.schedule('ses_parent', { state: 'waiting_provider', attempts: 0, nextWakeAt: 999_999, error: 'provider limit', at: 2 });
    const backend = fakeBackend({ sessions, active: { ses_child: {} } });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 10,
      owner: 'active-child',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    expect(store.get('ses_child').state).toBe('running');
    runtime.stop();
  });

  it('links a subagent from its session info and waits for its parent', async () => {
    const store = openStore(tempDb());
    const sessions = new Map([
      ['ses_parent', {
        info: { id: 'ses_parent', outcome: 'interrupted', time: { created: 1, updated: 2 } },
        messages: [userMessage('pu', 'parent work'), assistantMessage('pa', [{ id: 'p1', name: 'bash', status: 'running' }])],
      }],
      ['ses_child', {
        info: { id: 'ses_child', parentID: 'ses_parent', outcome: 'interrupted', time: { created: 1, updated: 2 } },
        messages: [userMessage('cu', 'child work'), assistantMessage('ca', [{ id: 'c1', name: 'bash', status: 'running' }])],
      }],
    ]);
    store.beginExecution({ sessionID: 'ses_parent', directory: 'C:/work', seq: 1, at: 1 });
    store.beginExecution({ sessionID: 'ses_child', directory: 'C:/work', seq: 1, at: 1 });
    store.schedule('ses_parent', { state: 'waiting_provider', attempts: 0, nextWakeAt: 999_999, error: 'provider limit', at: 2 });
    const backend = fakeBackend({ sessions });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 10,
      owner: 'parent-link',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();
    expect(store.get('ses_child').parent_session_id).toBe('ses_parent');
    expect(store.get('ses_child').state).toBe('waiting_parent');
    expect(store.get('ses_child').next_wake_at).toBe(300_010);
    expect(backend.prompts).toHaveLength(0);
    runtime.stop();
  });

  it('lets only one coordinator run against one ledger', async () => {
    const dbPath = tempDb();
    const sessions = seedInterruptedSessions(1);
    const first = openStore(dbPath);
    const second = openStore(dbPath);
    const backend = fakeBackend({ sessions });
    const runtimeA = createSessionRecoveryRuntime({ store: first, openCodeFetch: backend.fetchImpl, now: () => 1, owner: 'a' });
    const runtimeB = createSessionRecoveryRuntime({ store: second, openCodeFetch: backend.fetchImpl, now: () => 1, owner: 'b' });
    expect(runtimeA.start().hasLease).toBe(true);
    expect(runtimeB.start().hasLease).toBe(false);
    await runtimeB.reconcile();
    expect(backend.prompts).toHaveLength(0);
    runtimeA.stop();
    runtimeB.stop();
  });

  it('resumes elapsed waiting_provider rows even when last assistant turn has no error object, and supports resumeNow/dismiss/wakeWaitingProvider', async () => {
    const store = openStore(tempDb());
    const sessions = new Map([['ses_no_err', {
      info: { id: 'ses_no_err', outcome: 'failed', time: { created: 1, updated: 2 } },
      messages: [
        userMessage('u1', 'keep coding'),
        assistantMessage('a1', [{ id: 't1', name: 'bash', status: 'completed' }], { completed: true, completedAt: 500 }),
      ],
    }]]);
    store.beginExecution({ sessionID: 'ses_no_err', directory: 'C:/work', seq: 1, at: 400 });
    store.schedule('ses_no_err', { state: 'waiting_provider', attempts: 0, nextWakeAt: 1_000, error: 'provider limit', at: 600 });
    const backend = fakeBackend({ sessions });
    const events = [];
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 2_000,
      owner: 'resume-fix',
      startGraceMs: 60_000,
      broadcastEvent: (evt) => events.push(evt),
    });
    runtime.start();

    await runtime.resumeNow('ses_no_err');
    expect(backend.prompts).toHaveLength(1);
    expect(backend.prompts[0].body.text).toBe('Continue.');

    runtime.handleEvent({
      type: 'session.error',
      directory: 'C:/work',
      data: {
        sessionID: 'ses_err_evt',
        error: { type: 'APIError', status: 429, message: 'Usage limit reached, try again in 3 minutes' },
      },
    });
    expect(store.get('ses_err_evt').state).toBe('waiting_provider');
    expect(store.get('ses_err_evt').next_wake_at).toBe(2_000 + 3 * 60_000);

    const woken = runtime.wakeWaitingProvider();
    expect(woken).toEqual({ ok: true, updated: 1 });
    expect(store.get('ses_err_evt').next_wake_at).toBe(2_000);

    const dismissed = runtime.dismiss('ses_err_evt');
    expect(dismissed).toEqual({ ok: true, sessionID: 'ses_err_evt' });
    expect(store.get('ses_err_evt').state).toBe('completed');
    expect(events.some((e) => e.type === 'spleen:recovery')).toBe(true);
    runtime.stop();
  });

  it('auto-continues OpenCode Zen chats and subagents (even while parent is running) and skips non-Zen providers', async () => {
    const store = openStore(tempDb());
    const zenError = {
      type: 'provider.free-limit',
      providerID: 'opencode',
      message: 'OpenCode Zen free usage limit reached.',
      status: 429,
      retryAfterMs: 60_000,
    };
    const anthropicError = {
      type: 'provider.rate-limit',
      providerID: 'anthropic',
      message: 'Anthropic usage limit reached',
      status: 429,
      retryAfterMs: 60_000,
    };

    const sessions = new Map([
      ['ses_parent_running', {
        info: { id: 'ses_parent_running', outcome: 'interrupted', model: { providerID: 'opencode', id: 'big-pickle' }, time: { created: 1, updated: 100 } },
        messages: [userMessage('pu', 'delegate work'), assistantMessage('pa', [{ id: 't1', name: 'task', status: 'running' }])],
      }],
      ['ses_subagent_zen', {
        info: { id: 'ses_subagent_zen', parentID: 'ses_parent_running', outcome: 'failed', model: { providerID: 'opencode', id: 'big-pickle' }, time: { created: 1, updated: 1_000 } },
        messages: [
          userMessage('su', 'subagent task'),
          { ...assistantMessage('sa', [], { completed: true, completedAt: 1_000, error: zenError }), model: { providerID: 'opencode', id: 'big-pickle' } },
        ],
      }],
      ['ses_anthropic', {
        info: { id: 'ses_anthropic', outcome: 'failed', model: { providerID: 'anthropic', id: 'claude-sonnet' }, time: { created: 1, updated: 1_000 } },
        messages: [
          userMessage('au', 'other provider task'),
          { ...assistantMessage('aa', [], { completed: true, completedAt: 1_000, error: anthropicError }), model: { providerID: 'anthropic', id: 'claude-sonnet' } },
        ],
      }],
    ]);

    store.beginExecution({ sessionID: 'ses_parent_running', directory: 'C:/work', seq: 1, at: 100 });
    store.beginExecution({ sessionID: 'ses_subagent_zen', parentSessionID: 'ses_parent_running', directory: 'C:/work', seq: 1, at: 500 });
    store.schedule('ses_subagent_zen', { state: 'waiting_provider', attempts: 0, nextWakeAt: 61_000, error: 'provider limit', at: 1_000 });
    store.beginExecution({ sessionID: 'ses_anthropic', directory: 'C:/work', seq: 1, at: 500 });

    const backend = fakeBackend({ sessions, active: { ses_parent_running: {} } });
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => 62_000,
      owner: 'zen-subagents',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();

    // Stopped OpenCode Zen subagent must receive "Continue." even though its parent is running
    expect(backend.prompts).toHaveLength(1);
    expect(backend.prompts[0].sessionID).toBe('ses_subagent_zen');
    expect(backend.prompts[0].body.text).toBe('Continue.');

    // Non-Zen Anthropic session must be parked for manual resume only (never auto-continued)
    const anthRow = store.get('ses_anthropic');
    expect(anthRow.state).toBe('waiting_provider');
    expect(anthRow.last_error).toBe('provider limit (manual resume)');
    expect(anthRow.next_wake_at).toBeNull();
    runtime.stop();
  });

  it('discovers untracked stopped OpenCode Zen chats and subagents and sends Continue.', async () => {
    const store = openStore(tempDb());
    const sessions = new Map([
      ['ses_discovered_sub', {
        info: {
          id: 'ses_discovered_sub',
          parentID: 'ses_root_done',
          directory: 'C:/work',
          outcome: 'failed',
          model: { providerID: 'opencode', id: 'big-pickle' },
          time: { created: 1_000, updated: 1_000 },
        },
        messages: [
          userMessage('du', 'audit files'),
          {
            id: 'da',
            type: 'assistant',
            model: { providerID: 'opencode', id: 'big-pickle' },
            content: [{ type: 'text', text: 'Free usage limit reached. Try again in 2 minutes.' }],
            time: { created: 1_000, completed: 1_000 },
            finish: 'stop',
          },
        ],
      }],
    ]);

    const prompts = [];
    const fetchImpl = async (fetchPath, options = {}) => {
      const method = options.method || 'GET';
      if (fetchPath === '/api/session/active') return {};
      if (fetchPath === '/api/session') return Array.from(sessions.values()).map((s) => s.info);
      const promptMatch = fetchPath.match(/^\/api\/session\/([^/]+)\/prompt$/);
      if (method === 'POST' && promptMatch) {
        prompts.push({ sessionID: decodeURIComponent(promptMatch[1]), body: options.body });
        return { id: `inbox-${prompts.length}` };
      }
      const messageMatch = fetchPath.match(/^\/api\/session\/([^/]+)\/message$/);
      if (messageMatch) {
        return { data: sessions.get(decodeURIComponent(messageMatch[1])).messages, cursor: null };
      }
      const sessionMatch = fetchPath.match(/^\/api\/session\/([^/]+)$/);
      if (sessionMatch) {
        return sessions.get(decodeURIComponent(sessionMatch[1])).info;
      }
      throw new Error(`unexpected ${method} ${fetchPath}`);
    };

    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: fetchImpl,
      now: () => 1_000 + 3 * 60_000,
      owner: 'zen-discovery',
      startGraceMs: 0,
    });
    runtime.start();
    await runtime.reconcile();

    expect(prompts).toHaveLength(1);
    expect(prompts[0].sessionID).toBe('ses_discovered_sub');
    expect(prompts[0].body.text).toBe('Continue.');
    runtime.stop();
  });

  it('automatically wakes on the exact Zen 3s schedule via wake timer without waiting for pollMs', async () => {
    const store = openStore(tempDb());
    const startAt = Date.now();
    const error = {
      type: 'provider.free-limit',
      message: 'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
      status: 429,
      retryAfterMs: 75_982_000,
    };
    const sessions = new Map([
      ['ses_zen_live', {
        info: { id: 'ses_zen_live', directory: 'C:/work', outcome: 'failed', model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' }, time: { created: startAt - 1000, updated: startAt } },
        messages: [
          userMessage('u1', 'keep building'),
          { ...assistantMessage('a1', [], { completed: true, completedAt: startAt, error }), model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' } },
        ],
      }],
    ]);
    const backend = fakeBackend({ sessions });
    const clock = { at: startAt };
    const runtime = createSessionRecoveryRuntime({
      store,
      openCodeFetch: backend.fetchImpl,
      now: () => clock.at,
      owner: 'zen-wake-timer',
      pollMs: 60_000,
      startGraceMs: 60_000,
    });
    runtime.start();
    runtime.handleEvent({
      type: 'session.idle',
      directory: 'C:/work',
      data: { sessionID: 'ses_zen_live', outcome: 'failed', error },
    });
    expect(store.get('ses_zen_live').state).toBe('waiting_provider');
    expect(store.get('ses_zen_live').next_wake_at).toBe(startAt + 3_000);

    // Advance clock to 3s and trigger reconcile (startGraceMs=60s must NOT delay live Zen continuation)
    clock.at = startAt + 3_000;
    await runtime.reconcile();
    expect(backend.prompts).toHaveLength(1);
    expect(backend.prompts[0].sessionID).toBe('ses_zen_live');
    expect(backend.prompts[0].body.text).toBe('Continue.');
    runtime.stop();
  });
});
