import React from 'react';

type Args = {
  enabled?: boolean;
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>;
};

export const useSessionSearchEffects = ({ enabled = true, sessionSearchInputRef }: Args): void => {
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }
    const handleOpenRequest = () => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    };
    window.addEventListener('spleen:sidebar-session-search', handleOpenRequest);
    return () => window.removeEventListener('spleen:sidebar-session-search', handleOpenRequest);
  }, [enabled, sessionSearchInputRef]);
};
