import { isVSCodeRuntime } from '@/lib/desktop';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useSessionDraftsStore } from '@/stores/useSessionDraftsStore';

export const subscribeSessionDraftsSync = (runtimeKey: string): (() => void) => {
  if (isVSCodeRuntime()) return () => undefined;
  void useSessionDraftsStore.getState().load();
  return subscribeSpleenEvents((event) => {
    if (runtimeKey !== getRuntimeKey()) return;
    if (event.type === 'session-drafts-changed' || event.type === 'event-stream-ready') void useSessionDraftsStore.getState().load();
  });
};
