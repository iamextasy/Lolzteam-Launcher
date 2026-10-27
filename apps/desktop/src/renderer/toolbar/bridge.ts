import type {
  BookmarkEdit,
  BrowserBookmark,
  BrowserBookmarksState,
  BrowserExtensionInfo,
  BrowserTabsState,
  ExtensionPage,
} from '@shared-types';

export interface NavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
}

export type RetestResult = { ok: true; ms: number; ip: string } | { ok: false; message: string };

/** `window.browserNav`, as `preload/toolbar.ts` exposes it — mirrored, since the preload is not part of this build. */
export interface BrowserNavBridge {
  back: () => Promise<unknown>;
  forward: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  go: (url: string) => Promise<unknown>;
  copyUrl: () => Promise<unknown>;
  openExternal: () => Promise<unknown>;
  expand: () => Promise<unknown>;
  collapse: () => Promise<unknown>;
  proxyRetest: () => Promise<RetestResult>;
  openEmail: () => Promise<unknown>;
  bookmarkAdd: () => Promise<BrowserBookmark | null>;
  bookmarkRemove: (id: string) => Promise<unknown>;
  /** `null` when main refused the edit: not a web address, or another bookmark's. */
  bookmarkUpdate: (edit: BookmarkEdit) => Promise<BrowserBookmark | null>;
  /** In the active tab, or with `newTab` in a new one behind it. */
  bookmarkOpen: (id: string, newTab?: boolean) => Promise<unknown>;
  extensionOpen: (id: string, page: ExtensionPage) => Promise<unknown>;
  tabNew: () => Promise<unknown>;
  /** `fromKeyboard`: the strip keeps the keyboard instead of the next tab's page taking it. */
  tabClose: (id: number, fromKeyboard?: boolean) => Promise<unknown>;
  /** The tab already in front hands the keyboard back to its page. */
  tabActivate: (id: number) => Promise<unknown>;
  onState: (cb: (state: NavState) => void) => () => void;
  onBookmarks: (cb: (state: BrowserBookmarksState) => void) => () => void;
  onTabs: (cb: (state: BrowserTabsState) => void) => () => void;
  onFocusAddress: (cb: () => void) => () => void;
  onExtensions: (cb: (list: BrowserExtensionInfo[]) => void) => () => void;
}

declare global {
  interface Window {
    browserNav: BrowserNavBridge;
  }
}
