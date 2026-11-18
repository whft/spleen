import { describe, expect, test } from 'bun:test';
import { parseDeepLink } from './deepLinks';

describe('Usage provider deep-links for Android home widgets', () => {
  test('opens a built-in quota provider', () => {
    expect(parseDeepLink('spleen://settings/usage?provider=cursor')).toEqual({
      type: 'settings', section: 'usage', providerId: 'cursor',
    });
  });

  test('opens extension-supplied quota providers without the SDK guest', () => {
    expect(parseDeepLink('spleen://settings/usage?provider=ext-antigravity-usage')).toEqual({
      type: 'settings', section: 'usage', providerId: 'ext-antigravity-usage',
    });
  });

  test('keeps the ordinary Usage destination without a provider', () => {
    expect(parseDeepLink('spleen://settings/usage')).toEqual({
      type: 'settings', section: 'usage',
    });
  });

  test('ignores provider selection outside Usage and malformed provider ids', () => {
    expect(parseDeepLink('spleen://settings/appearance?provider=cursor')).toEqual({
      type: 'settings', section: 'appearance',
    });
    expect(parseDeepLink('spleen://settings/usage?provider=..%2Fsecrets')).toEqual({
      type: 'settings', section: 'usage',
    });
  });
});
