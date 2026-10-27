import type { BrowserWindow, WebContents } from 'electron';
import { MAIN_COLORS } from '../../theme';

/**
 * The colour a site is drawn on wherever it paints nothing of its own. Dark while there is no page to show — a blank
 * tab, a first page on its way, Chromium's error page (which is blank) — so none of them is a white flash at night.
 * Under a page that paints no background of its own it is Chromium's white: such a page's text is black, and would be
 * all but invisible on the dark (a proxy's «502 Bad Gateway», a plain «you may close this window»).
 */

/** Under a page with nothing to show yet, and under one that paints a background of its own. */
export const PAGE_BASE_DARK = MAIN_COLORS.bg;
/** Chromium's own canvas, under a page that leaves the canvas to the browser. */
export const PAGE_BASE_LIGHT = '#ffffff';

/** Chromium's `net::ERR_ABORTED`: a load called off, which leaves the page that was there. */
export const ERR_ABORTED = -3;

/** A tab with nothing of its own in it — a new tab: the address bar empty, «New tab» on the strip. */
export const isBlankUrl = (url: string): boolean => url === '' || url === 'about:blank';

/** The world the background is asked about in: not 0 (the page), 999 (Electron's), nor the shell's or the favicons'. */
const BACKGROUND_WORLD = 1209;

/**
 * Whether the page paints a background of its own: a colour that is not see-through, or an image, on its root or its
 * body — where the canvas takes its background from. Read in an isolated world: the page's styles answer, not its
 * scripts; the answer is data all the same.
 */
export const PAINTS_OWN_BACKGROUND = `(() => {
  const clear = (color) =>
    color === 'transparent' || /^rgba\\(.*,\\s*0\\)$/.test(color) || /\\/\\s*0\\)$/.test(color);
  const paints = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.backgroundImage !== 'none' || !clear(style.backgroundColor);
  };
  return paints(document.documentElement) || paints(document.body);
})()`;

/**
 * Keeps `apply`ing the base colour `wc`'s page needs: dark from the start, and again for an error page; each
 * document's own say once its DOM is ready, and again once it has stopped loading (a page may style itself late).
 * A new document keeps the last one's colour until it has its own say: the next page is most likely the same site's.
 * `apply` only runs when the colour changes.
 */
export const followPageBackground = (wc: WebContents, apply: (color: string) => void): void => {
  let current: string | null = null;
  /** Bumped by every document: an answer about the one before is dropped. */
  let doc = 0;
  let errorPage = false;

  const set = (color: string): void => {
    if (color === current) return;
    current = color;
    apply(color);
  };

  const check = (): void => {
    if (wc.isDestroyed()) return;
    if (errorPage || isBlankUrl(wc.getURL())) {
      set(PAGE_BASE_DARK);
      return;
    }
    const asked = doc;
    // A page that is gone throws rather than rejects.
    void Promise.resolve()
      .then(() =>
        wc.executeJavaScriptInIsolatedWorld(BACKGROUND_WORLD, [{ code: PAINTS_OWN_BACKGROUND }]),
      )
      .then((own: unknown) => {
        if (asked !== doc || wc.isDestroyed()) return;
        // Only a plain «no» lightens it: anything else keeps the dark.
        set(own === false ? PAGE_BASE_LIGHT : PAGE_BASE_DARK);
      })
      .catch(() => undefined);
  };

  set(PAGE_BASE_DARK);
  wc.on('did-navigate', () => {
    doc += 1;
    errorPage = false;
  });
  // A load that failed commits Chromium's error page — blank, and with no `did-navigate`.
  wc.on('did-fail-provisional-load', (_e, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) return;
    doc += 1;
    errorPage = true;
    set(PAGE_BASE_DARK);
  });
  wc.on('dom-ready', check);
  wc.on('did-stop-loading', check);
};

/** A window of its own — a site's popup, an extension's page — under the same rule as a tab. */
export const followWindowBackground = (win: BrowserWindow): void => {
  followPageBackground(win.webContents, (color) => {
    if (!win.isDestroyed()) win.setBackgroundColor(color);
  });
};
