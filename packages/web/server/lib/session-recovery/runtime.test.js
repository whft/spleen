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

const assistantMessage = (id, tools = [], { completed = false } = {}) => ({
  id,
  type: 'assistant',
  content: tools.map((tool) => ({
    type: 'tool',
    id: tool.id,
    name: tool.name,
    executed: tool.executed !== false,
    state: { status: tool.status, input: tool.input ?? {} },
  })),
  time: completed ? { created: 1, completed: 2 } : { created: 1 },
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
  it('names completed tools and unknown side effects', () => {
    const prompt = buildResumePrompt({
      sessionID: 'ses_x',
      executionSeq: 4,
      attempt: 1,
      tail: {
        lastUser: { text: 'ship it' },
        completedTools: [{ id: 't1', name: 'bash' }],
        unknownTools: [{ id: 't2', name: 'git' }],
      },
      childResults: [{ sessionID: 'ses_child', state: 'succeeded', summary: 'tests pass' }],
    });
    expect(prompt.text).toContain('do not run them again: bash (t1)');
    expect(prompt.text).toContain('Inspect the workspace');
    expect(prompt.text).toContain('Child session ses_child is succeeded');
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
});
