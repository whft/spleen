const CORE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
export const SPLEEN_ENGINE_PATTERN = /^(>=)?\d+\.\d+\.\d+$/;

type SpleenVersionParts = {
  major: number;
  minor: number;
  patch: number;
};

export const parseSpleenVersion = (value: string): SpleenVersionParts | null => {
  const core = String(value || '').trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const match = CORE_VERSION.exec(core);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareSpleenVersions = (left: string, right: string): number => {
  const a = parseSpleenVersion(left);
  const b = parseSpleenVersion(right);
  if (!a || !b) {
    return 0;
  }
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
};

export const spleenEngineMinimum = (engine: string): string | null => {
  const trimmed = engine.trim();
  if (!SPLEEN_ENGINE_PATTERN.test(trimmed)) {
    return null;
  }
  const floor = trimmed.startsWith('>=') ? trimmed.slice(2) : trimmed;
  return parseSpleenVersion(floor) ? floor : null;
};

export const hostMeetsSpleenEngine = (
  hostVersion: string,
  engine: string,
): boolean => {
  const minimum = spleenEngineMinimum(engine);
  if (!minimum) {
    return false;
  }
  if (!parseSpleenVersion(hostVersion)) {
    return false;
  }
  return compareSpleenVersions(hostVersion, minimum) >= 0;
};
