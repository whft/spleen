declare global {
  interface Window {
    __SPLEEN_VSCODE_SHIKI_THEMES__?: {
      light?: Record<string, unknown>;
      dark?: Record<string, unknown>;
    } | null;
  }
}

export {};

