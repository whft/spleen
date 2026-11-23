import React from 'react';
import type { TeamConstellation3DProps } from './TeamConstellation3DScene';

const LazyTeamConstellation3DScene = React.lazy(() => import('./TeamConstellation3DScene'));

export const TeamConstellation3D: React.FC<TeamConstellation3DProps> = React.memo((props) => (
  <React.Suspense
    fallback={
      <div
        className="flex w-full items-center justify-center rounded-lg border border-border/70 bg-[#08090A] font-mono text-[11px] text-muted-foreground"
        style={{ height: props.height ?? 224 }}
      >
        Initializing 3D topology…
      </div>
    }
  >
    <LazyTeamConstellation3DScene {...props} />
  </React.Suspense>
));

export default TeamConstellation3D;
