import { describe, expect, it } from 'vitest';
import { extractMentions, getReadyTasks, summarizeDag, validateDag } from './graph.js';

describe('teams DAG graph', () => {
  it('validates topological dependencies and detects missing/cyclic edges', () => {
    expect(validateDag([
      { id: 't1', dependsOn: [] },
      { id: 't2', dependsOn: ['t1'] },
      { id: 't3', dependsOn: ['t1', 't2'] },
    ])).toEqual({ valid: true, order: ['t1', 't2', 't3'] });

    expect(validateDag([{ id: 't1', dependsOn: ['missing'] }]).code).toBe('MISSING_DEPENDENCY');
    expect(validateDag([{ id: 't1', dependsOn: ['t1'] }]).code).toBe('SELF_DEPENDENCY');
    expect(validateDag([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ]).code).toBe('CYCLE_DETECTED');
  });

  it('respects dependencies and maxParallel cap in getReadyTasks', () => {
    const tasks = [
      { id: 'a', status: 'completed', dependsOn: [] },
      { id: 'b', status: 'running', dependsOn: ['a'] },
      { id: 'c', status: 'pending', dependsOn: ['a'] },
      { id: 'd', status: 'pending', dependsOn: ['a'] },
      { id: 'e', status: 'pending', dependsOn: ['c'] },
    ];
    expect(getReadyTasks(tasks, 2).map((t) => t.id)).toEqual(['c']);
    expect(getReadyTasks(tasks, 3).map((t) => t.id)).toEqual(['c', 'd']);
    expect(summarizeDag(tasks)).toEqual({
      total: 5,
      pending: 3,
      running: 1,
      completed: 1,
      failed: 0,
      cancelled: 0,
    });
  });

  it('extracts @member and @all mentions from board messages', () => {
    const members = [
      { id: 'm1', name: 'Lead', role: 'lead' },
      { id: 'm2', name: 'Backend Dev', role: 'backend' },
      { id: 'm3', name: 'QA', role: 'qa' },
    ];
    expect(extractMentions('Hey @backend please check tests with @QA', members)).toEqual(['m2', 'm3']);
    expect(extractMentions('Urgent update for @all members', members)).toEqual(['m1', 'm2', 'm3']);
    expect(extractMentions('No mentions here', members)).toEqual([]);
  });
});
