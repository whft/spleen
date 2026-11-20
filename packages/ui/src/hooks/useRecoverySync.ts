import React from 'react';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { useRecoveryStore } from '@/stores/useRecoveryStore';

export const useRecoverySync = (): void => {
  React.useEffect(() => {
    void useRecoveryStore.getState().refresh();
    return subscribeSpleenEvents((event) => {
      if (event.type === 'recovery') {
        useRecoveryStore.getState().applySnapshot(event.payload);
      } else if (event.type === 'event-stream-ready') {
        void useRecoveryStore.getState().refresh();
      }
    });
  }, []);
};
