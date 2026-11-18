
import React from 'react';

import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { useQuotaStore } from '@/stores/useQuotaStore';

export const useQuotaProviderSync = (): void => {
  React.useEffect(() => subscribeSpleenEvents((event) => {
    if (event.type !== 'quota-providers-changed' && event.type !== 'event-stream-ready') return;
    void useQuotaStore.getState().loadExtensionProviders();
  }), []);
};
