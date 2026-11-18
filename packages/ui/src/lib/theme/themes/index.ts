import type { Theme } from '@/types/theme';
import { presetThemes } from './presets';
import { withPrColors } from './prColors';
import { requireTheme } from '../definition';
import flexokiLightRaw from './flexoki-light.json';
import flexokiDarkRaw from './flexoki-dark.json';
import spleenLightRaw from './spleen-light.json';
import spleenDarkRaw from './spleen-dark.json';

const flexokiLightTheme = withPrColors(requireTheme(flexokiLightRaw));
const flexokiDarkTheme = withPrColors(requireTheme(flexokiDarkRaw));
const spleenLightTheme = withPrColors(requireTheme(spleenLightRaw));
const spleenDarkTheme = withPrColors(requireTheme(spleenDarkRaw));

export const DEFAULT_LIGHT_THEME_ID = 'spleen-light' as const;
export const DEFAULT_DARK_THEME_ID = 'spleen-dark' as const;

export const themes: Theme[] = [
  spleenLightTheme,
  spleenDarkTheme,
  flexokiLightTheme,
  flexokiDarkTheme,
  ...presetThemes.filter(
    (theme) => theme.metadata.id !== 'spleen-light' && theme.metadata.id !== 'spleen-dark',
  ),
];

export function getThemeById(id: string): Theme | undefined {
  const resolvedId =
    id === 'app-light' ? 'flexoki-light' :
    id === 'app-dark' ? 'flexoki-dark' :
    id;

  return themes.find(theme => theme.metadata.id === resolvedId);
}

export function getDefaultTheme(prefersDark: boolean): Theme {
  const variant: Theme['metadata']['variant'] = prefersDark ? 'dark' : 'light';

  const defaultId = prefersDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  const defaultTheme = getThemeById(defaultId);
  if (defaultTheme && defaultTheme.metadata.variant === variant) {
    return defaultTheme;
  }

  return themes.find((theme) => theme.metadata.variant === variant) ?? themes[0] ?? flexokiLightTheme;
}
