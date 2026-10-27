import type {
  BookmarkEdit,
  BrowserBookmark,
  BrowserBookmarksState,
  BrowserExtensionInfo,
  BrowserTabsState,
  ExtensionPage,
} from '@shared-types';
import { contextBridge, ipcRenderer } from 'electron';

// Literals, not `IPC_CHANNELS`: a sandboxed preload is one file and cannot import @shared-ipc at run time.
const BROWSER_NAV_BACK = 'browser-nav:back';
const BROWSER_NAV_FORWARD = 'browser-nav:forward';
const BROWSER_NAV_RELOAD = 'browser-nav:reload';
const BROWSER_NAV_STOP = 'browser-nav:stop';
const BROWSER_NAV_GO = 'browser-nav:go';
const BROWSER_NAV_COPY_URL = 'browser-nav:copy-url';
const BROWSER_NAV_OPEN_EXTERNAL = 'browser-nav:open-external';
const BROWSER_NAV_EXPAND = 'browser-nav:expand';
const BROWSER_NAV_COLLAPSE = 'browser-nav:collapse';
const BROWSER_NAV_PROXY_RETEST = 'browser-nav:proxy-retest';
const BROWSER_NAV_OPEN_EMAIL = 'browser-nav:open-email';
const BROWSER_NAV_STATE = 'browser-nav:state';
const BROWSER_NAV_BOOKMARKS = 'browser-nav:bookmarks';
const BROWSER_NAV_BOOKMARK_ADD = 'browser-nav:bookmark-add';
const BROWSER_NAV_BOOKMARK_REMOVE = 'browser-nav:bookmark-remove';
const BROWSER_NAV_BOOKMARK_UPDATE = 'browser-nav:bookmark-update';
const BROWSER_NAV_BOOKMARK_OPEN = 'browser-nav:bookmark-open';
const BROWSER_NAV_FOCUS_ADDRESS = 'browser-nav:focus-address';
const BROWSER_NAV_EXTENSIONS = 'browser-nav:extensions';
const BROWSER_NAV_EXTENSION_OPEN = 'browser-nav:extension-open';
const BROWSER_NAV_TABS = 'browser-nav:tabs';
const BROWSER_NAV_TAB_NEW = 'browser-nav:tab-new';
const BROWSER_NAV_TAB_CLOSE = 'browser-nav:tab-close';
const BROWSER_NAV_TAB_ACTIVATE = 'browser-nav:tab-activate';

type RetestResult = { ok: true; ms: number; ip: string } | { ok: false; message: string };

interface NavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
}

/** A main → toolbar event; the returned function unsubscribes. */
const listen = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_e: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

const browserNav = {
  back: () => ipcRenderer.invoke(BROWSER_NAV_BACK),
  forward: () => ipcRenderer.invoke(BROWSER_NAV_FORWARD),
  reload: () => ipcRenderer.invoke(BROWSER_NAV_RELOAD),
  stop: () => ipcRenderer.invoke(BROWSER_NAV_STOP),
  go: (url: string) => ipcRenderer.invoke(BROWSER_NAV_GO, url),
  copyUrl: () => ipcRenderer.invoke(BROWSER_NAV_COPY_URL),
  openExternal: () => ipcRenderer.invoke(BROWSER_NAV_OPEN_EXTERNAL),
  expand: () => ipcRenderer.invoke(BROWSER_NAV_EXPAND),
  collapse: () => ipcRenderer.invoke(BROWSER_NAV_COLLAPSE),
  proxyRetest: (): Promise<RetestResult> => ipcRenderer.invoke(BROWSER_NAV_PROXY_RETEST),
  openEmail: () => ipcRenderer.invoke(BROWSER_NAV_OPEN_EMAIL),
  /** Pins the page the window is on — main reads its URL itself; `null` when it cannot be pinned. */
  bookmarkAdd: (): Promise<BrowserBookmark | null> => ipcRenderer.invoke(BROWSER_NAV_BOOKMARK_ADD),
  bookmarkRemove: (id: string) => ipcRenderer.invoke(BROWSER_NAV_BOOKMARK_REMOVE, id),
  /** The editor's title and address; main validates them — `null` when refused (not a web address, a duplicate). */
  bookmarkUpdate: (edit: BookmarkEdit): Promise<BrowserBookmark | null> =>
    ipcRenderer.invoke(BROWSER_NAV_BOOKMARK_UPDATE, edit),
  /** By id, in the active tab — or, with `newTab`, in a new one behind it. */
  bookmarkOpen: (id: string, newTab?: boolean) =>
    ipcRenderer.invoke(BROWSER_NAV_BOOKMARK_OPEN, { id, newTab: newTab === true }),
  /** A blank tab in front, the address bar focused. */
  tabNew: () => ipcRenderer.invoke(BROWSER_NAV_TAB_NEW),
  /**
   * By the tab's id (`BrowserTab.id`); the last tab closed closes the window. `fromKeyboard`: the strip keeps the
   * keyboard, on the tab that takes its place, instead of handing it to that tab's page.
   */
  tabClose: (id: number, fromKeyboard?: boolean) =>
    ipcRenderer.invoke(BROWSER_NAV_TAB_CLOSE, id, fromKeyboard === true),
  /** The tab already in front hands the keyboard back to its page. */
  tabActivate: (id: number) => ipcRenderer.invoke(BROWSER_NAV_TAB_ACTIVATE, id),
  /** Opens an extension's popup or options page in a window of its own — by id; main looks the page up. */
  extensionOpen: (id: string, page: ExtensionPage) =>
    ipcRenderer.invoke(BROWSER_NAV_EXTENSION_OPEN, { id, page }),
  onState: (cb: (state: NavState) => void) => listen(BROWSER_NAV_STATE, cb),
  onBookmarks: (cb: (state: BrowserBookmarksState) => void) => listen(BROWSER_NAV_BOOKMARKS, cb),
  /** The tab strip, on load and whenever a tab opens, closes, switches, or changes its title, icon or loading. */
  onTabs: (cb: (state: BrowserTabsState) => void) => listen(BROWSER_NAV_TABS, cb),
  onFocusAddress: (cb: () => void) => listen(BROWSER_NAV_FOCUS_ADDRESS, cb),
  /** The enabled extensions, on load and whenever the list changes. */
  onExtensions: (cb: (list: BrowserExtensionInfo[]) => void) => listen(BROWSER_NAV_EXTENSIONS, cb),
} as const;

export type BrowserNavApi = typeof browserNav;

contextBridge.exposeInMainWorld('browserNav', browserNav);
