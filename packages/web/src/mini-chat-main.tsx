import { createConfiguredWebAPIs } from './runtimeConfig';
import type { RuntimeAPIs } from '@spleen/ui/lib/api/types';
import '@spleen/ui/index.css';
import '@spleen/ui/styles/fonts';
import '@spleen/ui/styles/katex-css';
import { importWithChunkRecovery } from '@spleen/ui/lib/chunkLoadRecovery';

declare global {
  interface Window {
    __SPLEEN_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

window.__SPLEEN_RUNTIME_APIS__ = createConfiguredWebAPIs();


void importWithChunkRecovery(() => import('@spleen/ui/apps/renderElectronMiniChatApp'))
  .then(({ renderElectronMiniChatApp }) => {
    renderElectronMiniChatApp(window.__SPLEEN_RUNTIME_APIS__ ?? createConfiguredWebAPIs());
  });
