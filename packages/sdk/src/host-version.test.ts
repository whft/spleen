import { describe, expect, test } from 'bun:test';

import {
  compareSpleenVersions,
  hostMeetsSpleenEngine,
  spleenEngineMinimum,
  parseSpleenVersion,
} from './host-version.ts';

describe('spleen host version', () => {
  test('parses core semver', () => {
    expect(parseSpleenVersion('1.22.0')).toEqual({ major: 1, minor: 22, patch: 0 });
    expect(parseSpleenVersion('v1.22.0-beta.1')).toEqual({ major: 1, minor: 22, patch: 0 });
    expect(parseSpleenVersion('junk')).toBeNull();
  });

  test('compares versions', () => {
    expect(compareSpleenVersions('1.22.0', '1.21.9')).toBeGreaterThan(0);
    expect(compareSpleenVersions('1.22.0', '1.22.0')).toBe(0);
    expect(compareSpleenVersions('1.21.0', '1.22.0')).toBeLessThan(0);
  });

  test('normalizes engines.spleen floors', () => {
    expect(spleenEngineMinimum('1.22.0')).toBe('1.22.0');
    expect(spleenEngineMinimum('>=1.22.0')).toBe('1.22.0');
    expect(spleenEngineMinimum('^1.22.0')).toBeNull();
  });

  test('checks host against engines.spleen', () => {
    expect(hostMeetsSpleenEngine('1.22.0', '>=1.22.0')).toBe(true);
    expect(hostMeetsSpleenEngine('1.22.0', '1.22.0')).toBe(true);
    expect(hostMeetsSpleenEngine('1.21.9', '>=1.22.0')).toBe(false);
    expect(hostMeetsSpleenEngine('unknown', '>=1.22.0')).toBe(false);
  });
});
