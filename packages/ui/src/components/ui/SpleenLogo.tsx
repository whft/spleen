import React, { useMemo } from 'react';
import { useReducedMotion } from 'motion/react';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { useI18n } from '@/lib/i18n';
import { useSpinnerPhase } from '@/hooks/useDurationTicker';
import { SPLEEN_LOGO_ART as ART } from './spleenLogoArt';

interface SpleenLogoProps {
  className?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
  variant?: 'default' | 'splash';
}

export const SpleenLogo: React.FC<SpleenLogoProps> = ({
  className = '',
  width = 70,
  height = 70,
  isAnimated = false,
  variant = 'default',
}) => {
  const { t } = useI18n();
  const themeContext = useOptionalThemeSystem();
  const reducedMotion = useReducedMotion();
  const animated = isAnimated && !reducedMotion;
  const beat = useSpinnerPhase(animated, 8);
  const dimmed = animated && beat >= 4;

  const color = useMemo(() => {
    if (variant === 'splash') {
      return 'var(--splash-stroke, var(--surface-foreground))';
    }
    if (themeContext) {
      return themeContext.currentTheme.colors.surface.foreground;
    }
    if (typeof window !== 'undefined') {
      const fromVars = getComputedStyle(document.documentElement).getPropertyValue('--splash-stroke').trim();
      if (fromVars) {
        return fromVars;
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'white' : 'black';
    }
    return 'white';
  }, [themeContext, variant]);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1000 1000"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={t('spleenLogo.aria.logo')}
    >
      <g
        style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity 500ms ease-in-out' }}
      >
        <g fill={color}>
          {ART.shell.map((path) => (
            <path key={path} d={path} />
          ))}
        </g>
        <path d={ART.core} fill={ART.accent} />
      </g>
    </svg>
  );
};
