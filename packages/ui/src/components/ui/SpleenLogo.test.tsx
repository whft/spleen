import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { SpleenLogo } from './SpleenLogo';
import { SPLEEN_LOGO_ART as ART } from './spleenLogoArt';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, getComputedStyle: browser.getComputedStyle.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

let root: Root;
let host: HTMLDivElement;

const render = (element: React.ReactElement) => act(async () => {
  root.render(<I18nProvider>{element}</I18nProvider>);
});
const advance = (ms: number) => act(async () => {
  jest.advanceTimersByTime(ms);
});
const mark = () => host.querySelector<SVGGElement>('svg > g');
const opacity = () => Number(mark()?.style.opacity);

beforeEach(() => {
  jest.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jest.useRealTimers();
});

test('renders the Spleen monogram blades and vermilion core', async () => {
  await render(<SpleenLogo />);
  const paths = [...host.querySelectorAll('svg path')].map((path) => path.getAttribute('d'));
  expect(paths).toEqual([...ART.shell, ART.core]);
  const core = host.querySelector('svg > g > path');
  expect(core?.getAttribute('d')).toBe(ART.core);
  expect(core?.getAttribute('fill')).toBe(ART.accent);
  expect(opacity()).toBe(1);
});

test('a loading logo breathes without touching its geometry', async () => {
  await render(<SpleenLogo isAnimated />);
  const paths = [...host.querySelectorAll('svg path')].map((path) => path.getAttribute('d'));

  await advance(1000);
  expect(opacity()).toBe(0.55);
  await advance(1000);
  expect(opacity()).toBe(1);
  expect([...host.querySelectorAll('svg path')].map((path) => path.getAttribute('d'))).toEqual(paths);
});

test('a still logo never dims', async () => {
  await render(<SpleenLogo />);
  await advance(3000);
  expect(opacity()).toBe(1);
});
