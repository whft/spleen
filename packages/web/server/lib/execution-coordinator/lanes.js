import { asNonEmptyString, isRecord } from '../shared/guards.js';

export const DEFAULT_LANE_LIMITS = Object.freeze({
  interactive: 8,
  recovery: 4,
  autonomy: 6,
  team: 6,
  subagent: 8,
  scheduled: 4,
});

export const createLaneScheduler = ({ limits = {} } = {}) => {
  const configured = { ...DEFAULT_LANE_LIMITS };
  if (isRecord(limits)) {
    for (const [key, value] of Object.entries(limits)) {
      const cap = Number(value);
      if (Number.isInteger(cap) && cap >= 1 && cap <= 64) {
        configured[key] = cap;
      }
    }
  }

  const lanes = new Map();

  const ensureLane = (name) => {
    const laneName = asNonEmptyString(name) || 'autonomy';
    let state = lanes.get(laneName);
    if (!state) {
      state = {
        name: laneName,
        limit: configured[laneName] ?? 4,
        active: new Map(),
        queue: [],
        seq: 0,
      };
      lanes.set(laneName, state);
    }
    return state;
  };

  const pump = (state) => {
    while (state.active.size < state.limit && state.queue.length > 0) {
      state.queue.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
      const next = state.queue.shift();
      if (!next || next.cancelled) continue;
      next.cleanupAbort?.();
      const token = `${state.name}_${next.seq}`;
      state.active.set(token, { key: next.key, startedAt: Date.now(), priority: next.priority });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        state.active.delete(token);
        pump(state);
      };
      next.resolve({ token, lane: state.name, release });
    }
  };

  const acquire = (laneName, { key = '', priority = 50, signal = null } = {}) => {
    const state = ensureLane(laneName);
    if (signal?.aborted) {
      return Promise.reject(Object.assign(new Error('Lane acquisition aborted'), { code: 'ABORT_ERR' }));
    }
    state.seq += 1;
    const seq = state.seq;
    const normalizedPriority = Number.isFinite(Number(priority)) ? Number(priority) : 50;
    const itemKey = asNonEmptyString(key) || `item_${seq}`;

    return new Promise((resolve, reject) => {
      const entry = {
        seq,
        key: itemKey,
        priority: normalizedPriority,
        cancelled: false,
        cleanupAbort: null,
        resolve,
        reject,
      };
      if (signal) {
        const onAbort = () => {
          if (entry.cancelled) return;
          entry.cancelled = true;
          const idx = state.queue.indexOf(entry);
          if (idx !== -1) state.queue.splice(idx, 1);
          reject(Object.assign(new Error('Lane acquisition aborted'), { code: 'ABORT_ERR' }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      }
      state.queue.push(entry);
      pump(state);
    });
  };

  const setLimit = (laneName, nextLimit) => {
    const cap = Number(nextLimit);
    if (!Number.isInteger(cap) || cap < 1 || cap > 64) return false;
    const state = ensureLane(laneName);
    state.limit = cap;
    configured[state.name] = cap;
    pump(state);
    return true;
  };

  const snapshot = () => {
    const out = {};
    for (const name of new Set([...Object.keys(configured), ...lanes.keys()])) {
      const state = ensureLane(name);
      out[name] = {
        limit: state.limit,
        active: state.active.size,
        queued: state.queue.filter((q) => !q.cancelled).length,
        activeKeys: [...state.active.values()].map((item) => item.key),
      };
    }
    return out;
  };

  return {
    acquire,
    setLimit,
    snapshot,
  };
};
