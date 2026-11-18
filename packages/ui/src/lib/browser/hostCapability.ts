export const canDriveBrowserPage = (): boolean => (
  Boolean(globalThis.window?.__SPLEEN_DESKTOP_RUNTIME__)
);
