import React from 'react';
import type { SpleenSpatialStage3DProps } from './SpleenSpatialStage3DScene';

const LazySpleenSpatialStage3DScene = React.lazy(() => import('./SpleenSpatialStage3DScene'));

export const SpleenSpatialStage3D: React.FC<SpleenSpatialStage3DProps> = React.memo(({ className }) => (
  <React.Suspense fallback={null}>
    <LazySpleenSpatialStage3DScene className={className} />
  </React.Suspense>
));

export default SpleenSpatialStage3D;
