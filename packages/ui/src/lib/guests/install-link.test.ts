import { describe, expect, test } from 'bun:test';

import { parseExtensionInstallLink } from './install-link.ts';

describe('parseExtensionInstallLink', () => {
  test('reads a repository and a folder', () => {
    expect(parseExtensionInstallLink('spleen://extensions/install?url=https%3A%2F%2Fgithub.com%2Fa%2Fb')).toEqual({ kind: 'url', source: 'https://github.com/a/b' });
    expect(parseExtensionInstallLink('spleen://extensions/install?path=/Users/me/my%20ext')).toEqual({ kind: 'path', source: '/Users/me/my ext' });
  });

  test('refuses anything else', () => {
    for (const href of [
      'spleen://session/ses_1',
      'spleen://extensions/install',
      'spleen://extensions/install?url=http://example.com/a',
      'spleen://extensions/install?url=file:///etc/passwd',
      'spleen://extensions/install?path=relative/folder',
    ]) expect(parseExtensionInstallLink(href)).toBeNull();
  });
});
