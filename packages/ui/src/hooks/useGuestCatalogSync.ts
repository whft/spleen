
import React from 'react';

import { loadGuestCatalog, reloadGuestCatalog } from '@/lib/guests/load-catalog';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';

export const useGuestCatalogSync = (): void => {
  React.useEffect(() => subscribeSpleenEvents((event) => {
    if (event.type === 'guests-changed') void reloadGuestCatalog();
    else if (event.type === 'event-stream-ready') void loadGuestCatalog();
  }), []);
};
