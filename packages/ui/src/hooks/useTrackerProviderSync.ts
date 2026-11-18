
import React from 'react';

import type { TrackerAPI } from '@/lib/api/types';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { refreshTrackers } from '@/stores/useTrackerAuthStore';

export const useTrackerProviderSync = (trackers: TrackerAPI | undefined): void => {
  React.useEffect(() => subscribeSpleenEvents((event) => {
    if (event.type !== 'tracker-providers-changed' && event.type !== 'event-stream-ready') return;
    void refreshTrackers(trackers);
  }), [trackers]);
};
