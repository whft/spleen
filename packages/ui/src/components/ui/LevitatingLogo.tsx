import React from 'react';
import { motion } from 'motion/react';
import { SpleenLogo } from '@/components/ui/SpleenLogo';

const DURATION_S = 1.8;

interface LevitatingLogoProps {
  size: number;
  color: string;
  onDone: () => void;
}

export const LevitatingLogo: React.FC<LevitatingLogoProps> = ({ size, color, onDone }) => (
  <motion.div
    aria-hidden="true"
    className="pointer-events-none absolute left-1/2 top-1/2"
    style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, color }}
    initial={{ y: 0 }}
    animate={{ y: [0, -size * 0.45, 0] }}
    transition={{ duration: DURATION_S, times: [0, 0.5, 1], ease: 'easeInOut' }}
    onAnimationComplete={onDone}
  >
    <SpleenLogo width={size} height={size} />
  </motion.div>
);
