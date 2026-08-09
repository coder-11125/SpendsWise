import { getLocale } from './i18n.svelte.js';

/**
 * Resolve the flatpickr locale object for the active UI language.
 *
 * flatpickr's core bundle only ships the English locale; Spanish lives in a
 * separate `flatpickr/dist/l10n/es.js` module. Returns the English locale
 * when the UI is English, so date pickers (month/day names, weekday order)
 * follow the app language. The Spanish module is loaded lazily and cached.
 */
export async function getFlatpickrLocale(
  fp: { l10ns?: Record<string, unknown> },
  loadSpanish: () => Promise<unknown> = loadSpanishModule
): Promise<unknown> {
  const locale = getLocale();
  if (locale === 'es') {
    return getSpanishFlatpickrLocale(fp, loadSpanish);
  }
  return fp.l10ns?.default;
}

let spanishLocaleCache: unknown;

async function getSpanishFlatpickrLocale(
  fp: { l10ns?: Record<string, unknown> },
  loadSpanish: () => Promise<unknown>
): Promise<unknown> {
  if (spanishLocaleCache) return spanishLocaleCache;
  try {
    const esMod = (await loadSpanish()) as {
      Spanish?: unknown;
      default?: { es?: unknown };
    };
    spanishLocaleCache =
      esMod.Spanish ?? esMod.default?.es ?? (fp.l10ns?.es as unknown) ?? fp.l10ns?.default;
  } catch {
    spanishLocaleCache = fp.l10ns?.default;
  }
  return spanishLocaleCache;
}

async function loadSpanishModule(): Promise<unknown> {
  return (await import('flatpickr/dist/l10n/es.js')) as unknown;
}

/** @internal Test hook: forget the cached Spanish locale. */
export function _clearFlatpickrLocaleCache(): void {
  spanishLocaleCache = undefined;
}
