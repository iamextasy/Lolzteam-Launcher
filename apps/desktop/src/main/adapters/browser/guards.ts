import type { AdapterLogger } from '@adapter-contract';
import { type PostBody, type Referrer, type Session, type WebContents, app, shell } from 'electron';
import { isEnabledExtensionUrl } from '../../services/extensions';
import { PAGE_BASE_DARK, followWindowBackground } from './page-background';

/** `http:`/`https:` and nothing else — the web, as opposed to the disk, a script, or a program on the machine. */
export const isWebUrl = (raw: string): boolean => {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Where a site, or a window it opened, may go: the web, and the pages of the launcher's own enabled extensions —
 * a popup links to its options page, SIH opens its own pages. Any other `chrome-extension://` (removed, switched
 * off, or never installed by the launcher) stays shut. Chromium still refuses a web page's navigation to an
 * extension resource the extension did not make web-accessible; this check only stops us from refusing more.
 */
export const isNavigableUrl = (raw: string): boolean => isWebUrl(raw) || isEnabledExtensionUrl(raw);

/**
 * Permissions granted without asking. Extension pages live in their account's session and so under these rules
 * too: SIH copies with `navigator.clipboard.writeText`, which is the sanitized write, and nothing else it does asks
 * the session; `notifications` stays refused for an extension as for a site.
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
]);

export const isAllowedPermission = (permission: string): boolean =>
  ALLOWED_PERMISSIONS.has(permission);

/** Deny every permission the page did not earn. */
export const guardSessionPermissions = (ses: Session, log: AdapterLogger): void => {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = isAllowedPermission(permission);
    if (!allowed) log.info(`[browser] denied permission "${permission}"`);
    callback(allowed);
  });
  // The synchronous half of the same question (`navigator.permissions.query`, and Electron's own internal checks).
  ses.setPermissionCheckHandler((_wc, permission) => isAllowedPermission(permission));
};

/**
 * Opens in a tab what a page asked to open as one, and returns the tab's `WebContents`. A `target=_blank` link or a
 * plain `window.open(url)` comes with the `WebContents` Chromium made and is navigating (`guest`) — the tab is built
 * around it, so `window.opener` holds. A middle- or Ctrl-clicked link comes with none: Electron then loads nothing,
 * and the tab loads `url` itself, with the referrer and the form's POST body, as Electron's own windows do.
 */
export type OpenTab = (
  guest: WebContents | undefined,
  request: {
    readonly url: string;
    readonly background: boolean;
    readonly opener: WebContents;
    readonly referrer?: Referrer;
    readonly postBody?: PostBody;
  },
) => WebContents;

/** Everything a page opens runs as the site views do, whatever its `window.open` features ask for. */
const guestPreferences = () => ({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
});

/**
 * Popups and off-web navigation, for one `WebContents`: a site view, an extension's page, and what either opens.
 * With `openTab` (the views of a window that has tabs) a link for a new tab opens one there; a popup with window
 * features — a trade confirmation, an OAuth sign-in — is still a window of its own, as is everything without it.
 */
export const guardWebContents = (wc: WebContents, log: AdapterLogger, openTab?: OpenTab): void => {
  wc.setWindowOpenHandler(({ url, disposition, referrer, postBody }) => {
    if (!isNavigableUrl(url)) {
      log.warn(`[browser] blocked window.open to a non-web URL: ${url.slice(0, 120)}`);
      return { action: 'deny' };
    }
    if (openTab && (disposition === 'foreground-tab' || disposition === 'background-tab')) {
      return {
        action: 'allow',
        // Electron would close the tab with the page that opened it; a tab stays, as in Chrome.
        outlivesOpener: true,
        overrideBrowserWindowOptions: { webPreferences: guestPreferences() },
        // Electron passes the new `WebContents` in `options.webContents`, which its typings leave out.
        createWindow: (options) =>
          openTab((options as { webContents?: WebContents }).webContents, {
            url,
            background: disposition === 'background-tab',
            opener: wc,
            referrer,
            postBody,
          }),
      };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        // Dark until its page has a say (`followWindowBackground`): no white flash.
        backgroundColor: PAGE_BASE_DARK,
        // No `partition`: a window opened this way inherits the opener's session on its own.
        webPreferences: guestPreferences(),
      },
    };
  });

  wc.on('did-create-window', (child) => {
    child.setMenu(null);
    followWindowBackground(child);
    // Its own links for a new tab open in the window's tabs too, as a Chrome popup's do.
    guardWebContents(child.webContents, log, openTab);
  });

  wc.on('will-navigate', (event, url) => {
    if (isNavigableUrl(url)) return;
    event.preventDefault();
    log.warn(`[browser] blocked navigation to a non-web URL: ${url.slice(0, 120)}`);
  });

  // `will-redirect` is the same check one step later: a server-side 3xx into `file://` never raises `will-navigate`.
  wc.on('will-redirect', (event, url) => {
    if (isNavigableUrl(url)) return;
    event.preventDefault();
    log.warn(`[browser] blocked redirect to a non-web URL: ${url.slice(0, 120)}`);
  });
};

/**
 * An MV2 extension's background page is a `WebContents` no shell created, so none guards it: its `window.open`
 * (and the compat shims' `tabs.create` / `windows.create`, which go through it) would open anything, anywhere.
 * It gets the site views' rules. An MV3 service worker has no `WebContents` and cannot open a window this way.
 */
export const guardExtensionBackgrounds = (log: AdapterLogger): void => {
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() === 'backgroundPage') guardWebContents(wc, log);
  });
};

/** The same `file:` document as `current`, whatever its query or fragment: the toolbar reloading itself. */
export const isSameFilePage = (url: string, current: string): boolean => {
  try {
    const next = new URL(url);
    const now = new URL(current);
    return (
      next.protocol === 'file:' &&
      now.protocol === 'file:' &&
      next.host === now.host &&
      next.pathname === now.pathname
    );
  } catch {
    return false;
  }
};

/**
 * The toolbar is ours and local: it never opens anything and never navigates — not even to a file dropped onto it,
 * which it would otherwise open in its own place, preload and all. Over a new tab it covers the whole window.
 */
export const guardLocalWebContents = (wc: WebContents, log: AdapterLogger): void => {
  wc.setWindowOpenHandler(({ url }) => {
    log.warn(`[browser] toolbar tried to open a window: ${url.slice(0, 120)}`);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    // The dev server reloads the toolbar through a normal navigation; in a packaged build it is its own file.
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) {
      return;
    }
    if (isSameFilePage(url, wc.getURL())) return;
    event.preventDefault();
    log.warn(`[browser] toolbar tried to navigate: ${url.slice(0, 120)}`);
  });
};

/** Re-exported for the one caller that opens a URL the *user* clicked. */
export const openExternalIfWeb = (url: string): void => {
  if (isWebUrl(url)) void shell.openExternal(url);
};
