import { isVSCodeRuntime } from '@/lib/desktop';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useSessionWarmingStore } from '@/stores/useSessionWarmingStore';

export const subscribeSessionWarmingSync = (runtimeKey: string): (() => void) => {
  const store = useSessionWarmingStore.getState();
  store.reset();
  if (isVSCodeRuntime()) return () => undefined;

  const refresh = () => {
    void store.refresh(() => runtimeKey === getRuntimeKey()).catch((error) => console.warn('[session-warming] failed to read the state', error));
  };
  refresh();
  return subscribeSpleenEvents((event) => {
    if (runtimeKey !== getRuntimeKey()) return;
    if (event.type === 'event-stream-ready') refresh();
    else if (event.type === 'session-warming') store.applySnapshot(event.snapshot);
  });
};
