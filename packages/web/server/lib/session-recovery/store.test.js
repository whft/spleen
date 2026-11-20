import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from './store.js';

const tempDirs = [];
const stores = [];

const openStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spleen-recovery-store-'));
  tempDirs.push(dir);
  const store = createRecoveryStore({ filePath: path.join(dir, 'recovery.sqlite3') });
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed
    }
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('recovery store', () => {
  it('adds provider waits when opening a ledger from the previous schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spleen-recovery-migrate-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'recovery.sqlite3');
    const first = createRecoveryStore({ filePath });
    first.beginExecution({ sessionID: 'ses_old', seq: 1, at: 1 });
    first.close();

    const db = new DatabaseSync(filePath);
    db.exec('ALTER TABLE executions DROP COLUMN provider_waits');
    db.exec('ALTER TABLE executions DROP COLUMN resumed_at');
    db.exec('DELETE FROM schema_migrations WHERE version IN (2, 3)');
    db.close();

    const store = createRecoveryStore({ filePath });
    stores.push(store);
    expect(store.get('ses_old').provider_waits).toBe(0);
    expect(store.get('ses_old').resumed_at).toBeNull();
  });

  it('keeps resume counters across the resumed execution only', () => {
    const store = openStore();
    store.beginExecution({ sessionID: 'ses_a', seq: 1, at: 1 });
    store.schedule('ses_a', {
      state: 'recovering',
      attempts: 1,
      providerWaits: 2,
      nextWakeAt: 60_000,
      resumeMessageID: 'inbox-1',
      resumedAt: 2,
      at: 2,
    });

    store.beginExecution({ sessionID: 'ses_a', seq: 2, at: 3 });
    const resumed = store.get('ses_a');
    expect(resumed.state).toBe('running');
    expect(resumed.attempts).toBe(1);
    expect(resumed.provider_waits).toBe(2);
    expect(resumed.resumed_at).toBe(2);
    expect(resumed.resume_message_id).toBe('inbox-1');

    store.finish('ses_a', 'completed', { at: 4 });
    const finished = store.get('ses_a');
    expect(finished.attempts).toBe(1);
    expect(finished.provider_waits).toBe(0);
    expect(finished.resumed_at).toBeNull();

    store.beginExecution({ sessionID: 'ses_a', seq: 3, at: 5 });
    const freshTurn = store.get('ses_a');
    expect(freshTurn.attempts).toBe(0);
    expect(freshTurn.resume_message_id).toBeNull();
  });

  it('records tool outcomes as evidence for a resume', () => {
    const store = openStore();
    store.beginExecution({ sessionID: 'ses_a', seq: 1, at: 1 });
    store.noteTool({ sessionID: 'ses_a', toolID: 't1', name: 'bash', status: 'completed', executed: true, at: 2 });
    store.noteTool({ sessionID: 'ses_a', toolID: 't2', name: 'edit', status: 'failed', executed: true, external: true, at: 3 });
    expect(store.toolsFor('ses_a')).toEqual([
      { toolID: 't1', name: 'bash', status: 'completed', executed: true, external: false },
      { toolID: 't2', name: 'edit', status: 'failed', executed: true, external: true },
    ]);
  });

  it('grants one coordinator lease at a time and takes over after expiry or dead PID', () => {
    const store = openStore();
    expect(store.tryAcquireLease('a', 1_000, 0)).toBe(true);
    expect(store.tryAcquireLease('b', 1_000, 500)).toBe(false);
    expect(store.tryAcquireLease('b', 1_000, 1_001)).toBe(true);

    expect(store.tryAcquireLease('99999999-dead-owner', 60_000, 2_002)).toBe(true);
    expect(store.tryAcquireLease(`${process.pid}-live-owner`, 60_000, 2_500)).toBe(true);
    expect(store.tryAcquireLease('other-owner', 60_000, 3_000)).toBe(false);
  });
});
