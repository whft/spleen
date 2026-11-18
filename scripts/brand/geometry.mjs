// Spleen mark geometry. A ring, an S spine with three nodes, and two soft
// interior gradients. One definition feeds the in-app logo, the loading
// screens, the favicon and the Windows icon, so they cannot drift apart.

export const SPLEEN_INK = '#f3efe7';
export const SPLEEN_ACCENT = '#d9503f';
export const SPLEEN_TILE = '#0b0f14';

export const TIER_SCALES = [0.8, 0.58, 0.36];
export const FLAT_TIER_OPACITY = [0.22, 0.27, 0.85];
export const FLAT_TIER_REST = [0.12, 0.15, 0.38];
export const FLAT_TIER_LIT = [0.55, 0.48, 0.85];

const RING = 'M0 -44 A44 44 0 1 1 -0.01 -44 Z';
const SPINE = 'M16 -26 C6 -36 -16 -32 -18 -16 C-20 -2 8 0 14 12 C20 24 4 32 -8 30 C-14 29 -18 26 -20 22';

export const FLAT_LOGO = {
  shell: [RING, SPINE],
  stroke: 2.4,
  roof: 'M-31 -31 A44 44 0 0 1 31 -31 A36 36 0 0 0 -31 -31 Z',
  roofOpacity: 0.08,
  tiers: [
    'M-10 -23 a5 5 0 1 0 0.01 0 Z',
    'M2 -2 a5 5 0 1 0 0.01 0 Z',
    'M-5 22 a5 5 0 1 0 0.01 0 Z',
  ],
  tierOpacity: FLAT_TIER_OPACITY,
  tierRest: FLAT_TIER_REST,
  tierLit: FLAT_TIER_LIT,
  walls: [
    {
      path: 'M0 -44 A44 44 0 0 0 0 44 L0 -44 Z',
      gradient: {
        x1: -40,
        y1: -30,
        x2: -4,
        y2: 10,
        stops: [[0, 0.03], [0.7, 0.12], [1, 0.2]],
      },
    },
    {
      path: 'M0 -44 A44 44 0 0 1 0 44 L0 -44 Z',
      gradient: {
        x1: 40,
        y1: 20,
        x2: 4,
        y2: -20,
        stops: [[0, 0.06], [0.7, 0.16], [1, 0.24]],
      },
    },
  ],
};

const ESC = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export const flatLogoInner = ({ color = 'currentColor', idPrefix = 'spleen-logo-' } = {}) => {
  const defs = FLAT_LOGO.walls
    .map(({ gradient }, index) => {
      const stops = gradient.stops
        .map(([offset, opacity]) => `<stop offset="${offset}" stop-color="${ESC(color)}" stop-opacity="${opacity}"/>`)
        .join('');
      return `<linearGradient id="${idPrefix}${index === 0 ? 'l' : 'r'}" gradientUnits="userSpaceOnUse" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">${stops}</linearGradient>`;
    })
    .join('');
  const walls = FLAT_LOGO.walls
    .map(({ path }, index) => `<path d="${path}" fill="url(#${idPrefix}${index === 0 ? 'l' : 'r'})"/>`)
    .join('');
  const tiers = FLAT_LOGO.tiers
    .map((path, index) => `<path data-tier="${index}" data-rest="${FLAT_LOGO.tierRest[index]}" data-lit="${FLAT_LOGO.tierLit[index]}" d="${path}" fill="${ESC(color)}" fill-opacity="${FLAT_LOGO.tierOpacity[index]}"/>`)
    .join('');
  const shell = FLAT_LOGO.shell.map((path) => `<path d="${path}"/>`).join('');
  return `<defs>${defs}</defs>${walls}<path d="${FLAT_LOGO.roof}" fill="${ESC(color)}" fill-opacity="${FLAT_LOGO.roofOpacity}"/>${tiers}<g fill="none" stroke="${ESC(color)}" stroke-width="${FLAT_LOGO.stroke}" stroke-linejoin="round" stroke-linecap="round">${shell}</g>`;
};

export const flatLogoSvg = ({ color = 'currentColor', size = 512 } = {}) => (
  `<svg width="${size}" height="${size}" viewBox="-50 -50 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Spleen">${flatLogoInner({ color })}</svg>`
);

export const appIconSvg = ({ size = 1024 } = {}) => {
  const mark = flatLogoInner({ color: SPLEEN_INK, idPrefix: 'spleen-icon-' });
  const accent = `<circle cx="-10" cy="-23" r="5" fill="${SPLEEN_ACCENT}"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="22" fill="${SPLEEN_TILE}"/><g transform="translate(50 50) scale(0.78)">${mark}${accent}</g></svg>`;
};

export const traySvg = ({ size = 32, color = SPLEEN_INK } = {}) => (
  `<svg width="${size}" height="${size}" viewBox="-50 -50 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">${flatLogoInner({ color, idPrefix: 'spleen-tray-' })}</svg>`
);

export const logoArtModule = () => {
  const walls = FLAT_LOGO.walls
    .map(({ path, gradient }) => `    {
      path: '${path}',
      gradient: {
        x1: ${gradient.x1},
        y1: ${gradient.y1},
        x2: ${gradient.x2},
        y2: ${gradient.y2},
        stops: [${gradient.stops.map(([offset, opacity]) => `[${offset}, ${opacity}]`).join(', ')}],
      },
    },`)
    .join('\n');
  return `export const SPLEEN_LOGO_ART = {
  shell: [
${FLAT_LOGO.shell.map((path) => `    '${path}',`).join('\n')}
  ],
  stroke: ${FLAT_LOGO.stroke},
  roof: '${FLAT_LOGO.roof}',
  roofOpacity: ${FLAT_LOGO.roofOpacity},
  tiers: [
${FLAT_LOGO.tiers.map((path) => `    '${path}',`).join('\n')}
  ],
  tierOpacity: [${FLAT_LOGO.tierOpacity.join(', ')}],
  tierRest: [${FLAT_LOGO.tierRest.join(', ')}],
  tierLit: [${FLAT_LOGO.tierLit.join(', ')}],
  walls: [
${walls}
  ],
} as const;
`;
};
