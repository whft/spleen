import type { HostedSurface } from '@/lib/runtimeSurface';

declare global {
  interface Window {
    __SPLEEN_SURFACE__?: HostedSurface;
  }
}
