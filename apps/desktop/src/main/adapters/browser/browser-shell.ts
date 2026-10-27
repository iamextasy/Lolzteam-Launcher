import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterLogger } from '@adapter-contract';
import type { BrowserNavState, ProxyTestResult } from '@shared-ipc';
import { IPC_CHANNELS } from '@shared-ipc';
import type {
  BookmarkEdit,
  BrowserBookmark,
  BrowserBookmarksState,
  BrowserExtensionInfo,
  BrowserTabsState,
  ExtensionPage,
  LauncherSettings,
  ProxyEntry,
} from '@shared-types';
import {
  BrowserWindow,
  type WebContents,
  WebContentsView,
  clipboard,
  ipcMain,
  session,
} from 'electron';
import {
  extensionPageUrl,
  listExtensions,
  onExtensionsChange,
  releaseSessionExtensions,
} from '../../services/extensions';
import { testProxy } from '../../services/proxy';
import {
  getCachedSettings,
  getSettings,
  onSettingsChange,
  setSettings,
} from '../../settings/settings-store';
import { getMainWindow, showMainWindow } from '../../window/main-window';
import {
  addBookmark,
  applyFavicon,
  chromeHeight,
  readBookmarkEdit,
  readBookmarkOpen,
  readBookmarks,
  removeBookmark,
  updateBookmark,
} from './bookmarks';
import {
  guardLocalWebContents,
  guardSessionPermissions,
  guardWebContents,
  isWebUrl,
  openExternalIfWeb,
} from './guards';
import { PAGE_BASE_DARK, followWindowBackground } from './page-background';
import { type ShortcutAction, matchShortcut, yieldsToTextField } from './shortcuts';
import { createTabs } from './tabs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface ShellController {
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  go: (url: string) => void;
  copyUrl: () => void;
  openExternal: () => void;
  expand: () => void;
  collapse: () => void;
  proxyRetest: () => Promise<ProxyTestResult>;
  openEmail: () => void;
  bookmarkAdd: () => Promise<BrowserBookmark | null>;
  bookmarkRemove: (id: string) => Promise<void>;
  bookmarkUpdate: (edit: BookmarkEdit) => Promise<BrowserBookmark | null>;
  bookmarkOpen: (id: string, newTab: boolean) => void;
  extensionOpen: (id: string, page: ExtensionPage) => Promise<void>;
  tabNew: () => void;
  /**
   * Both by the tab's id; one that is not a tab of this window is ignored. `fromKeyboard`: closed from the strip's
   * keyboard, which keeps the keyboard — on the tab that takes its place — instead of handing it to that tab's page.
   */
  tabClose: (id: number, fromKeyboard: boolean) => void;
  tabActivate: (id: number) => void;
}

const controllers = new Map<number, ShellController>();
let handlersWired = false;

const wireHandlers = (): void => {
  if (handlersWired) return;
  handlersWired = true;
  const get = (id: number): ShellController | undefined => controllers.get(id);
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_BACK, (e) => get(e.sender.id)?.back());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_FORWARD, (e) => get(e.sender.id)?.forward());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_RELOAD, (e) => get(e.sender.id)?.reload());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_STOP, (e) => get(e.sender.id)?.stop());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_GO, (e, url: string) => get(e.sender.id)?.go(url));
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_COPY_URL, (e) => get(e.sender.id)?.copyUrl());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL, (e) => get(e.sender.id)?.openExternal());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_EXPAND, (e) => get(e.sender.id)?.expand());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_COLLAPSE, (e) => get(e.sender.id)?.collapse());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST, (e) => {
    const ctl = get(e.sender.id);
    if (!ctl) return { ok: false, message: 'toolbar gone' } satisfies ProxyTestResult;
    return ctl.proxyRetest();
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_OPEN_EMAIL, (e) => get(e.sender.id)?.openEmail());
  ipcMain.handle(
    IPC_CHANNELS.BROWSER_NAV_BOOKMARK_ADD,
    async (e) => (await get(e.sender.id)?.bookmarkAdd()) ?? null,
  );
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_BOOKMARK_REMOVE, (e, id: unknown) => {
    if (typeof id === 'string') return get(e.sender.id)?.bookmarkRemove(id);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_BOOKMARK_UPDATE, async (e, raw: unknown) => {
    const edit = readBookmarkEdit(raw);
    const ctl = get(e.sender.id);
    return edit && ctl ? ctl.bookmarkUpdate(edit) : null;
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_BOOKMARK_OPEN, (e, raw: unknown) => {
    const req = readBookmarkOpen(raw);
    if (req) get(e.sender.id)?.bookmarkOpen(req.id, req.newTab);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_TAB_NEW, (e) => get(e.sender.id)?.tabNew());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_TAB_CLOSE, (e, id: unknown, fromKeyboard: unknown) => {
    if (typeof id === 'number') get(e.sender.id)?.tabClose(id, fromKeyboard === true);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_TAB_ACTIVATE, (e, id: unknown) => {
    if (typeof id === 'number') get(e.sender.id)?.tabActivate(id);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_EXTENSION_OPEN, (e, req: unknown) => {
    const { id, page } = (req ?? {}) as { id?: unknown; page?: unknown };
    if (typeof id === 'string' && (page === 'popup' || page === 'options')) {
      return get(e.sender.id)?.extensionOpen(id, page);
    }
  });
};

/**
 * Every window's settings listener behind one subscription to the store: one each would trip Node's leak warning
 * at the eleventh, and a multi-account user has that many open on a normal day.
 */
const settingsListeners = new Set<(next: LauncherSettings) => void>();
let settingsWired = false;

const onShellSettings = (cb: (next: LauncherSettings) => void): (() => void) => {
  if (!settingsWired) {
    settingsWired = true;
    onSettingsChange((next) => {
      for (const fn of settingsListeners) fn(next);
    });
  }
  settingsListeners.add(cb);
  return () => {
    settingsListeners.delete(cb);
  };
};

/**
 * Bookmark edits from every window, one at a time, each on the list the one before it wrote: the store's cached copy
 * changes only once a write is on disk, so two edits read side by side would each drop the other's.
 */
let bookmarkEdits: Promise<unknown> = Promise.resolve();

const editBookmarks = <T>(
  edit: (current: readonly BrowserBookmark[]) => Promise<T>,
): Promise<T> => {
  const run = bookmarkEdits.then(async () =>
    edit(readBookmarks((await getSettings()).browserBookmarks)),
  );
  bookmarkEdits = run.catch(() => undefined);
  return run;
};

// Turn raw address-bar input into a safe URL. Only http/https are allowed;
// anything that looks like a bare domain gets https://, everything else becomes
// a Google search. file:/javascript: and friends are rejected.
const normalizeAddress = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;

  // A scheme we don't trust (e.g. file:, javascript:) — treat as a search.
  const hasUnknownScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const looksLikeDomain = !hasUnknownScheme && /\.[^\s.]+$/.test(value) && !/\s/.test(value);

  if (looksLikeDomain) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
};

const buildProxyQuery = (proxy: ProxyEntry, proxyTest?: { ip: string; ms: number }): string => {
  const params = new URLSearchParams({
    proxy: '1',
    label: proxy.label ?? '',
    host: proxy.host,
    port: String(proxy.port),
    ms: proxyTest ? String(proxyTest.ms) : '',
  });
  return params.toString();
};

const loadToolbar = (view: WebContentsView, query: string): void => {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    const suffix = query ? `?${query}` : '';
    void view.webContents.loadURL(`${devServerUrl}/toolbar/index.html${suffix}`);
  } else {
    void view.webContents.loadFile(join(__dirname, '../renderer/toolbar/index.html'), {
      search: query,
    });
  }
};

/**
 * Whether a text field has focus in the page. Asked in an isolated world, so the page's own
 * scripts cannot answer for it; a focused frame counts as one — what has focus inside it is not ours to see.
 */
const FOCUS_IS_EDITABLE = `(() => {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'].includes(el.tagName);
})()`;
/** Any id but 0 (the page) and 999 (Electron's preload world). */
const PROBE_WORLD = 1207;

/** An extension's popup is a small panel in Chrome, its options page a whole tab. */
const EXTENSION_WINDOW: Readonly<Record<ExtensionPage, { width: number; height: number }>> = {
  popup: { width: 420, height: 600 },
  options: { width: 1000, height: 760 },
};

/** What a toolbar's extensions menu lists: the enabled ones — those loaded into its window's session. */
const toolbarExtensions = (list: readonly BrowserExtensionInfo[]): BrowserExtensionInfo[] =>
  list.filter((ext) => ext.enabled);

export interface BrowserShellOptions {
  partition: string;
  log: AdapterLogger;
  proxy?: ProxyEntry;
  proxyTest?: { ip: string; ms: number };
  /** When set, the toolbar shows an email icon that opens this mailbox. */
  emailPassword?: string;
}

/**
 * The window's chrome — tab strip, toolbar and bookmarks bar, one view over the page — and its tabs. `siteView` is
 * the first tab: the adapters load their landing page into it, and their hooks on it (Telegram's scripts planted
 * before the page's, the LLM autofill on every load, Discord's token) apply to that tab only. Tabs opened later are
 * the user's own browsing, in the same session.
 */
export const createBrowserShell = (
  win: BrowserWindow,
  opts: BrowserShellOptions,
): { siteView: WebContentsView } => {
  wireHandlers();

  const toolbarView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/toolbar.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Transparent so the toolbar can expand over the site — for its menus, and as the cover over a new tab or a first
  // page on its way — while only what it draws paints: until it does, the tab's own dark background shows through.
  toolbarView.setBackgroundColor('#00000000');

  const ses = session.fromPartition(opts.partition);
  guardSessionPermissions(ses, opts.log);
  guardLocalWebContents(toolbarView.webContents, opts.log);

  const toolbar = toolbarView.webContents;

  /** The toolbar's menus are open: it fills the window, for their backdrop. */
  let expanded = false;
  /** It covers the site area (`tabs.covered`): a new tab's page, or a loading placeholder in place of a white flash. */
  let covered = false;
  // The settings are loaded long before any account window opens; the fallback below is for the impossible case.
  const initial = getCachedSettings();
  let rawBookmarks: unknown = initial?.browserBookmarks;
  let bookmarks = readBookmarks(rawBookmarks);
  let showBar = initial?.browserBookmarksBar ?? true;

  // Everything down to `createTabs` reads `tabs` only when it runs — on an event, never while the tabs are made.

  /** The address bar and the buttons describe the active tab; switching tabs sends it again. */
  const pushState = (): void => {
    const site = tabs.active();
    const tab = tabs.current();
    if (toolbar.isDestroyed() || !site || !tab) return;
    const state: BrowserNavState = {
      url: tab.url,
      canGoBack: site.navigationHistory.canGoBack(),
      canGoForward: site.navigationHistory.canGoForward(),
      isLoading: tab.isLoading,
      title: tab.title,
    };
    toolbar.send(IPC_CHANNELS.BROWSER_NAV_STATE, state);
  };

  const pushTabs = (state: BrowserTabsState): void => {
    if (toolbar.isDestroyed()) return;
    toolbar.send(IPC_CHANNELS.BROWSER_NAV_TABS, state);
  };

  const pushBookmarks = (): void => {
    if (toolbar.isDestroyed()) return;
    const state: BrowserBookmarksState = { bookmarks, showBar };
    toolbar.send(IPC_CHANNELS.BROWSER_NAV_BOOKMARKS, state);
  };

  const focusAddress = (): void => {
    if (toolbar.isDestroyed()) return;
    toolbar.focus();
    toolbar.send(IPC_CHANNELS.BROWSER_NAV_FOCUS_ADDRESS);
  };

  /** The active tab's page takes the keyboard — or, in a new tab, the address bar does. */
  const focusActive = (): void => {
    const site = tabs.active();
    if (!site) return;
    if (tabs.activeIsNew()) focusAddress();
    else site.focus();
  };

  /** Set while a tab closes from the strip's keyboard: the strip keeps the keyboard. */
  let stripKeepsKeyboard = false;

  /** A tab came to the front: its page takes the keyboard, as in Chrome — unless the strip is being worked from the keys. */
  const onActivated = (): void => {
    pushState();
    cover();
    if (!stripKeepsKeyboard) focusActive();
  };

  /** The active tab moved on: the bar describes it again, and the cover follows its page. */
  const onActiveChanged = (): void => {
    pushState();
    cover();
  };

  /** A page's icon onto every bookmark of these URLs (a redirect's start and end), one write for them all. */
  const withPageIcon = (
    list: readonly BrowserBookmark[],
    urls: readonly string[],
    icon: string,
  ): readonly BrowserBookmark[] =>
    urls.reduce((acc, url) => applyFavicon(acc, url, icon).list, list);

  /** A page's favicon onto its bookmarks — checked against the list in hand first, so a page load costs no write. */
  const takePageIcon = (urls: readonly string[], icon: string): void => {
    if (withPageIcon(bookmarks, urls, icon) === bookmarks) return;
    void editBookmarks(async (current) => {
      const next = withPageIcon(current, urls, icon);
      if (next !== current) await setSettings({ browserBookmarks: [...next] });
    }).catch((err: unknown) => {
      opts.log.warn(`[browser-shell] bookmark icon not saved: ${String(err)}`);
    });
  };

  const load = (url: string): void => {
    tabs.load(url);
    // The page, not the toolbar, gets the keyboard after a navigation — as after Enter in Chrome's omnibox.
    tabs.active()?.focus();
  };

  const back = (): void => {
    const site = tabs.active();
    if (site?.navigationHistory.canGoBack()) site.navigationHistory.goBack();
  };
  const forward = (): void => {
    const site = tabs.active();
    if (site?.navigationHistory.canGoForward()) site.navigationHistory.goForward();
  };

  const proxyRetest = (): Promise<ProxyTestResult> => {
    if (!opts.proxy) return Promise.resolve({ ok: false, message: 'no proxy' });
    return testProxy({
      host: opts.proxy.host,
      port: opts.proxy.port,
      username: opts.proxy.username,
      password: opts.proxy.password,
    });
  };

  // The URL, title and favicon are read off the active tab here, never taken from the toolbar — and now, not when
  // the edit's turn comes: by then the page (or the window) may be another.
  const bookmarkAdd = (): Promise<BrowserBookmark | null> => {
    const site = tabs.active();
    if (!site) return Promise.resolve(null);
    const page = { url: site.getURL(), title: site.getTitle(), icon: tabs.activeFavicon() };
    return editBookmarks(async (current) => {
      const res = addBookmark(current, page, randomUUID);
      if (!res.bookmark) return null;
      // Pinned before, without this icon: it takes the page's now.
      const iconed =
        !res.added && page.icon
          ? applyFavicon(res.list, page.url, page.icon)
          : { list: res.list, changed: false };
      if (res.added || iconed.changed) await setSettings({ browserBookmarks: [...iconed.list] });
      const { id } = res.bookmark;
      return iconed.list.find((b) => b.id === id) ?? res.bookmark;
    });
  };

  const bookmarkRemove = (id: string): Promise<void> =>
    editBookmarks(async (current) => {
      const next = removeBookmark(current, id);
      if (next !== current) await setSettings({ browserBookmarks: [...next] });
    });

  /** The editor's title and address, validated as any save is; `null` keeps the editor open with its error. */
  const bookmarkUpdate = (edit: BookmarkEdit): Promise<BrowserBookmark | null> =>
    editBookmarks(async (current) => {
      const res = updateBookmark(current, edit);
      if (res.changed) await setSettings({ browserBookmarks: [...res.list] });
      return res.bookmark;
    }).catch((err: unknown) => {
      opts.log.warn(`[browser-shell] bookmark edit not saved: ${String(err)}`);
      return null;
    });

  // By id, from the list main holds: `readBookmarks` has already dropped anything that is not a web URL.
  const openBookmark = (bookmark: BrowserBookmark | undefined, newTab = false): boolean => {
    if (!bookmark || !isWebUrl(bookmark.url)) return false;
    // Behind the current tab, as a middle-clicked bookmark opens in Chrome.
    if (newTab) tabs.open(bookmark.url, { background: true });
    else load(bookmark.url);
    return true;
  };

  /** A blank tab in front; activating it hands the keyboard to the address bar. */
  const tabNew = (): void => {
    tabs.open(null);
  };

  /**
   * Runs a shortcut; `false` when it turned out to mean nothing here, so the key stays the page's. What opens, closes
   * or switches tabs waits for the key event to finish: the view taking the key may be the one going.
   */
  const runShortcut = (action: ShortcutAction): boolean => {
    const site = tabs.active();
    const later = (fn: () => void): true => {
      setImmediate(fn);
      return true;
    };
    switch (action.kind) {
      case 'reload':
        site?.reload();
        return true;
      case 'hardReload':
        site?.reloadIgnoringCache();
        return true;
      case 'back':
        back();
        return true;
      case 'forward':
        forward();
        return true;
      case 'focusAddress':
        focusAddress();
        return true;
      case 'stop':
        if (!site?.isLoading()) return false;
        site.stop();
        return true;
      case 'addBookmark':
        void bookmarkAdd().catch((err: unknown) => {
          opts.log.warn(`[browser-shell] bookmark failed: ${String(err)}`);
        });
        return true;
      case 'openBookmark':
        return openBookmark(bookmarks[action.index]);
      case 'newTab':
        return later(tabNew);
      case 'closeTab': {
        const id = tabs.current()?.id;
        return later(() => {
          if (id !== undefined) tabs.close(id);
        });
      }
      case 'nextTab':
        return later(() => tabs.cycle(1));
      case 'prevTab':
        return later(() => tabs.cycle(-1));
      case 'reopenTab':
        return later(() => void tabs.reopenClosed());
    }
  };

  /** Every tab's keys, before the page sees them. */
  const wireShortcuts = (site: WebContents): void => {
    site.on('before-input-event', (event, input) => {
      const action = matchShortcut(input, process.platform);
      if (!action) return;
      if ((action.kind === 'back' || action.kind === 'forward') && action.caret) {
        // macOS ⌘←/⌘→: the key goes to the page either way; it is history only when no text field took it.
        void site
          .executeJavaScriptInIsolatedWorld(PROBE_WORLD, [{ code: FOCUS_IS_EDITABLE }])
          .then((editable: unknown) => {
            if (editable !== true && !site.isDestroyed()) runShortcut(action);
          })
          .catch(() => undefined);
        return;
      }
      if (runShortcut(action)) event.preventDefault();
    });
  };

  const tabs = createTabs({
    win,
    partition: opts.partition,
    log: opts.log,
    proxy: opts.proxy,
    onCreated: wireShortcuts,
    onActivated,
    onActiveChanged,
    onStrip: pushTabs,
    onPageIcon: takePageIcon,
    // The last tab closed is the window closed, as in Chrome.
    onEmpty: () => {
      if (!win.isDestroyed()) win.close();
    },
  });
  // Added after the first tab, the toolbar is on top; every later tab goes in under it.
  win.contentView.addChildView(toolbarView);

  const layout = (): void => {
    // A tab's last events can outlive the window by a moment.
    if (win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    const top = chromeHeight(bookmarks, showBar);
    toolbarView.setBounds(
      expanded || covered ? { x: 0, y: 0, width, height } : { x: 0, y: 0, width, height: top },
    );
    tabs.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  };

  /**
   * The cover follows the active tab: up over a new tab and a first page on its way, down the moment that page is
   * ready — the toolbar shrinks back to its bars here, before it has even heard, and the page is there under it.
   */
  const cover = (): void => {
    const next = tabs.covered();
    if (next === covered) return;
    covered = next;
    layout();
  };
  covered = tabs.covered();
  layout();

  /**
   * One window per extension page (`<id>/<page>`): asked again, the open one comes forward. `path` is the folder the
   * extension was loaded from in this session when the page last loaded — the instance the page is bound to.
   */
  const extensionWindows = new Map<string, { window: BrowserWindow; path: string | null }>();
  const loadedPath = (id: string): string | null => ses.getExtension(id)?.path ?? null;
  /** Pages between the click and their window: a double click must not open two. */
  const openingPages = new Set<string>();

  const pushExtensions = (list: readonly BrowserExtensionInfo[]): void => {
    if (toolbar.isDestroyed()) return;
    toolbar.send(IPC_CHANNELS.BROWSER_NAV_EXTENSIONS, toolbarExtensions(list));
  };

  // The loader has already applied the change to this window's session; the toolbar follows the list. A page of
  // an extension that was switched off or removed goes with it — there is nothing left behind it to run — and one
  // that was installed anew (a newer version, or the same one reinstalled into another folder) is reloaded into the
  // new instance: the old one is gone, and every `chrome.*` call of a page bound to it fails.
  const offExtensions = onExtensionsChange((list) => {
    pushExtensions(list);
    const live = new Set(toolbarExtensions(list).map((ext) => ext.id));
    for (const [key, open] of extensionWindows) {
      if (open.window.isDestroyed()) continue;
      const id = key.split('/')[0] ?? '';
      if (!live.has(id)) {
        open.window.close();
        continue;
      }
      const path = loadedPath(id);
      // Not loaded at all: a login of this account is clearing the session, and loads it again itself.
      if (path !== null && path !== open.path) {
        open.path = path;
        open.window.webContents.reload();
      }
    }
  });

  // Every window follows the list: a page pinned in one window shows up on the bar of all of them.
  const applySettings = (next: LauncherSettings): void => {
    if (next.browserBookmarks === rawBookmarks && next.browserBookmarksBar === showBar) return;
    rawBookmarks = next.browserBookmarks;
    bookmarks = readBookmarks(rawBookmarks);
    showBar = next.browserBookmarksBar;
    layout();
    pushBookmarks();
  };
  const offSettings = onShellSettings(applySettings);
  if (!initial) {
    void getSettings()
      .then(applySettings)
      .catch(() => undefined);
  }

  /**
   * Electron draws no extension popups, so a popup or an options page opens as a child window of this one, in this
   * account's session — the only session the extension is loaded into for this account — and under the site's guards.
   * A link it opens for a new tab opens as a tab of this window.
   */
  const extensionOpen = async (id: string, page: ExtensionPage): Promise<void> => {
    const key = `${id}/${page}`;
    const open = extensionWindows.get(key);
    if (open && !open.window.isDestroyed()) {
      open.window.focus();
      return;
    }
    if (openingPages.has(key)) return;
    openingPages.add(key);
    let url: string | null;
    let ext: BrowserExtensionInfo | undefined;
    try {
      // By id, from the registry: the toolbar names an extension, never a URL.
      url = await extensionPageUrl(id, page);
      ext = (await listExtensions()).find((e) => e.id === id);
    } finally {
      openingPages.delete(key);
    }
    if (!url || !ext || win.isDestroyed()) return;

    const child = new BrowserWindow({
      ...EXTENSION_WINDOW[page],
      parent: win,
      title: ext.name,
      backgroundColor: PAGE_BASE_DARK,
      autoHideMenuBar: true,
      webPreferences: {
        partition: opts.partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    child.setMenu(null);
    // Dark until its page has a say — an extension's page that leaves its canvas to Chromium is drawn on white.
    followWindowBackground(child);
    // The extension's name, not whatever its page calls itself: it is how the user tells two of them apart.
    child.on('page-title-updated', (e) => e.preventDefault());
    guardWebContents(child.webContents, opts.log, tabs.openFromPage);
    extensionWindows.set(key, { window: child, path: loadedPath(id) });
    child.on('closed', () => {
      if (extensionWindows.get(key)?.window === child) extensionWindows.delete(key);
    });
    void child.webContents.loadURL(url).catch((err: unknown) => {
      opts.log.warn(`[browser-shell] extension page failed to load: ${String(err)}`);
    });
  };

  controllers.set(toolbar.id, {
    back,
    forward,
    reload: () => tabs.active()?.reload(),
    stop: () => tabs.active()?.stop(),
    go: (url) => {
      const target = normalizeAddress(url);
      if (target) load(target);
    },
    copyUrl: () => {
      const site = tabs.active();
      if (site) clipboard.writeText(site.getURL());
    },
    openExternal: () => {
      const site = tabs.active();
      if (site) openExternalIfWeb(site.getURL());
    },
    expand: () => {
      expanded = true;
      layout();
    },
    collapse: () => {
      expanded = false;
      layout();
    },
    proxyRetest,
    openEmail: () => {
      if (!opts.emailPassword) return;
      showMainWindow();
      getMainWindow()?.webContents.send(IPC_CHANNELS.MAIL_OPEN_REQUEST, {
        emailPassword: opts.emailPassword,
      });
    },
    bookmarkAdd,
    bookmarkRemove,
    bookmarkUpdate,
    bookmarkOpen: (id, newTab) =>
      void openBookmark(
        bookmarks.find((b) => b.id === id),
        newTab,
      ),
    extensionOpen,
    tabNew,
    tabClose: (id, fromKeyboard) => {
      stripKeepsKeyboard = fromKeyboard;
      try {
        tabs.close(id);
      } finally {
        stripKeepsKeyboard = false;
      }
    },
    tabActivate: (id) => {
      // A click on the tab already in front (it took the keyboard to the strip): Chrome hands it back to the page.
      if (tabs.current()?.id === id) focusActive();
      else tabs.activate(id);
    },
  });

  // The toolbar's one text field is the address bar: Esc and the caret chords go on to the toolbar, which uses them
  // there and, with the focus anywhere else in it (after a click on Back, say), runs them itself.
  toolbar.on('before-input-event', (event, input) => {
    const action = matchShortcut(input, process.platform);
    if (!action || yieldsToTextField(action)) return;
    if (runShortcut(action)) event.preventDefault();
  });

  // The mouse's back/forward buttons (Windows and Linux).
  const onAppCommand = (_e: Electron.Event, command: string): void => {
    if (command === 'browser-backward') back();
    else if (command === 'browser-forward') forward();
  };
  win.on('app-command', onAppCommand);

  toolbar.on('did-finish-load', () => {
    pushState();
    pushTabs(tabs.state());
    pushBookmarks();
    void listExtensions().then(pushExtensions);
  });
  const params = new URLSearchParams(opts.proxy ? buildProxyQuery(opts.proxy, opts.proxyTest) : '');
  if (opts.emailPassword) params.set('email', '1');
  params.set('lang', getCachedSettings()?.locale === 'en' ? 'en' : 'ru');
  params.set('os', process.platform);
  loadToolbar(toolbarView, params.toString());

  const onResize = (): void => layout();
  win.on('resize', onResize);

  win.on('closed', () => {
    win.off('resize', onResize);
    win.off('app-command', onAppCommand);
    offSettings();
    offExtensions();
    for (const open of extensionWindows.values()) {
      if (!open.window.isDestroyed()) open.window.close();
    }
    // The login's hold on the session ends with its window; the last window of the account takes the extensions.
    void releaseSessionExtensions(ses);
    controllers.delete(toolbar.id);
    tabs.dispose();
    if (!toolbar.isDestroyed()) toolbar.close();
  });

  return { siteView: tabs.first };
};
