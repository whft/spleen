import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { recoveryStatusSchema, type RecoveryStatusPayload } from '@/lib/spleenEvents';

export type RecoverySessionEntry = RecoveryStatusPayload['sessions'][number];

const ACTIVE_RECOVERY_STATES = new Set(['waiting_provider', 'recovering', 'waiting_parent', 'needs_review']);

type RecoveryState = {
  coordinator: boolean;
  sessionsById: Record<string, RecoverySessionEntry>;
  busySessionIds: Record<string, boolean>;
  applySnapshot: (payload: RecoveryStatusPayload) => void;
  refresh: () => Promise<void>;
  resumeNow: (sessionId: string) => Promise<boolean>;
  dismiss: (sessionId: string) => Promise<boolean>;
  wakeAll: () => Promise<void>;
};

export const useRecoveryStore = create<RecoveryState>()((set, get) => ({
  coordinator: false,
  sessionsById: {},
  busySessionIds: {},

  applySnapshot: (payload) => {
    const next: Record<string, RecoverySessionEntry> = {};
    for (const entry of payload.sessions) {
      if (ACTIVE_RECOVERY_STATES.has(entry.state)) {
        next[entry.sessionID] = entry;
      }
    }
    set({
      coordinator: payload.coordinator,
      sessionsById: next,
    });
  },

  refresh: async () => {
    try {
      const response = await runtimeFetch('/api/recovery/status', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const parsed = recoveryStatusSchema.safeParse(await response.json());
      if (parsed.success) {
        get().applySnapshot(parsed.data);
      }
    } catch {
      // Transient host errors resolve on the next SSE or poll cycle.
    }
  },

  resumeNow: async (sessionId) => {
    set((state) => ({ busySessionIds: { ...state.busySessionIds, [sessionId]: true } }));
    try {
      const response = await runtimeFetch(`/api/recovery/${encodeURIComponent(sessionId)}/resume`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      await get().refresh();
      return response.ok;
    } catch {
      return false;
    } finally {
      set((state) => {
        const nextBusy = { ...state.busySessionIds };
        delete nextBusy[sessionId];
        return { busySessionIds: nextBusy };
      });
    }
  },

  dismiss: async (sessionId) => {
    set((state) => ({ busySessionIds: { ...state.busySessionIds, [sessionId]: true } }));
    try {
      const response = await runtimeFetch(`/api/recovery/${encodeURIComponent(sessionId)}/dismiss`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        set((state) => {
          const next = { ...state.sessionsById };
          delete next[sessionId];
          return { sessionsById: next };
        });
      }
      return response.ok;
    } catch {
      return false;
    } finally {
      set((state) => {
        const nextBusy = { ...state.busySessionIds };
        delete nextBusy[sessionId];
        return { busySessionIds: nextBusy };
      });
    }
  },

  wakeAll: async () => {
    try {
      await runtimeFetch('/api/recovery/wake', { method: 'POST', headers: { Accept: 'application/json' } });
      await get().refresh();
    } catch {
      // ignore
    }
  },
}));
