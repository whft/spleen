import { describe, expect, test } from 'bun:test';

import { LOCALES } from '../runtime';
import { spleenToolsLayoutI18n } from './spleen-tools-layout.i18n';

describe('Spleen Tools layout translations', () => {
  test('every locale has every key, filled in', () => {
    const englishKeys = Object.keys(spleenToolsLayoutI18n.en).sort();
    for (const locale of LOCALES) {
      const dictionary: Record<string, string> = spleenToolsLayoutI18n[locale];
      expect(Object.keys(dictionary).sort()).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(dictionary[key]?.trim()).toBeTruthy();
      }
    }
  });

  test('group headings are translated, not copied from English', () => {
    for (const locale of LOCALES) {
      if (locale === 'en') continue;
      for (const key of ['settings.spleen.tools.group.work', 'settings.spleen.tools.group.chat', 'settings.spleen.tools.group.knowledge'] as const) {
        expect(`${locale} ${spleenToolsLayoutI18n[locale][key]}`).not.toBe(`${locale} ${spleenToolsLayoutI18n.en[key]}`);
      }
    }
  });
});
