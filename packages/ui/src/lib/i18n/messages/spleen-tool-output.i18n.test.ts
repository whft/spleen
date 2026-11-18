import { describe, expect, test } from 'bun:test';

import { SPLEEN_ACTION_VERB_KEYS } from '@/components/chat/message/parts/spleenToolEnvelope';
import { spleenToolOutputI18n } from './spleen-tool-output.i18n';

const locales = ['en', 'de', 'fr', 'nl', 'es', 'ja', 'pt-BR', 'uk', 'ko', 'pl', 'zh-CN', 'zh-TW', 'tr', 'ar', 'he'] as const;

describe('Spleen tool output translations', () => {
  test('every locale has every key, filled', () => {
    const keys = Object.keys(spleenToolOutputI18n.en).sort();
    for (const locale of locales) {
      const dictionary: Record<string, string> = spleenToolOutputI18n[locale];
      expect(Object.keys(dictionary).sort()).toEqual(keys);
      for (const key of keys) expect(dictionary[key]?.trim()).toBeTruthy();
    }
  });

  test('every action verb has a key', () => {
    for (const key of Object.values(SPLEEN_ACTION_VERB_KEYS)) {
      expect(key in spleenToolOutputI18n.en).toBe(true);
    }
  });
});
