import React from 'react';
import { SpleenLogo } from './SpleenLogo';
import type { SpleenMonolith3DProps } from './SpleenMonolith3DScene';
import { cn } from '@/lib/utils';

const LazySpleenMonolith3DScene = React.lazy(() => import('./SpleenMonolith3DScene'));

export const SpleenMonolith3D: React.FC<SpleenMonolith3DProps> = React.memo(
  ({ size = 96, className, interactive = true }) => {
    const fallbackIconSize = Math.round(size * 0.56);
    return (
      <React.Suspense
        fallback={
          <div
            className={cn('inline-flex items-center justify-center select-none', className)}
            style={{ width: size, height: size }}
          >
            <SpleenLogo width={fallbackIconSize} height={fallbackIconSize} className="opacity-90" />
          </div>
        }
      >
        <LazySpleenMonolith3DScene size={size} className={className} interactive={interactive} />
      </React.Suspense>
    );
  },
);

export default SpleenMonolith3D;
