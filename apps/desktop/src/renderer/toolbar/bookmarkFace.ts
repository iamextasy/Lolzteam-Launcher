import type { BrowserBookmark } from '@shared-types';

/**
 * How a bookmark looks: its name, and its favicon or — until main has fetched one — a coloured
 * letter. Shared by the toolbar's bar and the settings list, so a site looks the same in both.
 */

export const bookmarkHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** The title, else the host, else the URL itself. */
export const bookmarkLabel = (b: BrowserBookmark): string =>
  b.title.trim() || bookmarkHost(b.url) || b.url;

/** The site's first letter; the title's for a non-Latin domain, which `URL` spells as `xn--…`. */
export const bookmarkLetter = (b: BrowserBookmark): string => {
  const host = bookmarkHost(b.url);
  const source = host && !host.startsWith('xn--') ? host : bookmarkLabel(b);
  return Array.from(source)[0]?.toUpperCase() ?? '?';
};

/** A hue per host, so a site keeps its colour on every bar. */
export const bookmarkHue = (b: BrowserBookmark): number => {
  let h = 0;
  for (const ch of bookmarkHost(b.url)) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
};

/** An icon the toolbar can draw: only a `data:image/…` URL gets past its CSP, so anything else is none. */
export const iconSrc = (icon: string | null | undefined): string | null =>
  typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null;
