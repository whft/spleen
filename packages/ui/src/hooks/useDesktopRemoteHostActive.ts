import React from 'react';

import { isDesktopLocalOriginActive, isDesktopShell } from '@/lib/desktop';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

const readDesktopRemoteHostActive = (): boolean => isDesktopShell() && !isDesktopLocalOriginActive();

export const useDesktopRemoteHostActive = (): boolean =>
  React.useSyncExternalStore(subscribeRuntimeEndpointChanged, readDesktopRemoteHostActive, readDesktopRemoteHostActive);
