import { isVSCodeRuntime } from '@/lib/desktop';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { applyLaterPages, applyLaterPagesSnapshot, laterPagesSnapshotSchema } from './later-pages';

const isLaterPagesAvailable = (): boolean => !isVSCodeRuntime();

const hydrateLaterPages = async (): Promise<void> => {
  if (!isLaterPagesAvailable()) return;
  const runtimeKey = getRuntimeKey();
  const response = await runtimeFetch('/api/spleen/render/later', { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Later pages failed to load (${response.status})`);
  const parsed = laterPagesSnapshotSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Invalid later pages response');
  if (runtimeKey !== getRuntimeKey()) return;
  applyLaterPagesSnapshot(parsed.data);
};

export const subscribeLaterPagesSync = (runtimeKey: string): (() => void) => {
  if (!isLaterPagesAvailable()) return () => undefined;
  void hydrateLaterPages().catch(() => undefined);
  return subscribeSpleenEvents((event) => {
    if (runtimeKey !== getRuntimeKey()) return;
    if (event.type === 'event-stream-ready') void hydrateLaterPages().catch(() => undefined);
    else if (event.type === 'spleen:render-later.updated') {
      applyLaterPages(event.properties.revision, event.properties.sessionID, event.properties.pages);
    }
  });
};
