import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { DraftStudioHero } from './ComposerDraftTitle';

describe('DraftStudioHero', () => {
  test('renders the studio emblem, Spleen mark, and single display heading', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <DraftStudioHero heading="What are we working on in Spleen?" projectLabel="Spleen" className="mb-7" />
      </I18nProvider>,
    );
    expect(html).toContain('oc-studio-emblem');
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toContain('What are we working on in ');
    expect(html).toContain('Spleen');
    expect(html).toContain('<svg');
  });

  test('renders plain heading when no project label is set', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <DraftStudioHero heading="What are we working on?" projectLabel={null} />
      </I18nProvider>,
    );
    expect(html).toContain('oc-studio-emblem');
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toContain('What are we working on?');
  });
});
