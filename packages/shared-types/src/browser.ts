/** A page pinned to the bookmarks bar of every browser window. */
export interface BrowserBookmark {
  readonly id: string;
  readonly title: string;
  /** `http:`/`https:` only. */
  readonly url: string;
  /** The site's favicon as a `data:image/…;base64,` URL — the toolbar's CSP admits no remote image. */
  readonly icon?: string;
}

/** A favicon bigger than this is not a favicon; the settings file carries every one of them. */
export const MAX_BOOKMARK_ICON_CHARS = 65_536;

/** What the bookmark editor in the toolbar sends back; main validates it like any other save. */
export interface BookmarkEdit {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

/** Opens a bookmark by id — in the active tab, or (middle / Ctrl-click, the menu) in a new one. */
export interface BookmarkOpenRequest {
  readonly id: string;
  readonly newTab?: boolean;
}

/** One tab of a browser window, as its tab strip draws it. */
export interface BrowserTab {
  /** The tab's `webContents.id`: unique for the life of the process. */
  readonly id: number;
  readonly title: string;
  readonly url: string;
  /** A `data:` URL, or `null` while there is none (the strip draws a placeholder). */
  readonly favicon: string | null;
  readonly isLoading: boolean;
  /**
   * The tab has shown a real page (its first non-blank navigation reached `dom-ready`, or loading stopped).
   * Until then the toolbar covers the site area with a dark placeholder instead of a white flash.
   */
  readonly ready: boolean;
  /**
   * A page's link opened the tab, and Chromium navigates it: while blank it is no new tab — its opener may write
   * into it — so nothing covers it, neither the new tab page nor the loading placeholder.
   */
  readonly adopted: boolean;
}

export interface BrowserTabsState {
  readonly tabs: readonly BrowserTab[];
  readonly activeId: number;
}

/** More than this is a bar nobody can read. */
export const MAX_BROWSER_BOOKMARKS = 50;

/** What a toolbar is told about the bookmarks: the list, and whether to draw the bar at all. */
export interface BrowserBookmarksState {
  readonly bookmarks: readonly BrowserBookmark[];
  readonly showBar: boolean;
}

/** An installed Chrome extension, as the launcher lists it. */
export interface BrowserExtensionInfo {
  /** The Chrome extension id: 32 letters `a`–`p`. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly enabled: boolean;
  /** `webstore` installs can be updated from the store; `file` ones cannot. */
  readonly source: 'webstore' | 'file';
  readonly manifestVersion: 2 | 3;
  readonly permissions: readonly string[];
  readonly hostPermissions: readonly string[];
  readonly hasPopup: boolean;
  readonly hasOptions: boolean;
  /** A `data:` URL — the app's CSP refuses `file:` images — or `null`. */
  readonly icon: string | null;
  readonly installedAt: number;
}

/** Where an extension is installed from. */
export type ExtensionInstallSource =
  /** A Chrome Web Store link or a bare extension id. */
  | { readonly kind: 'webstore'; readonly input: string }
  /** A `.crx` or `.zip` on disk. */
  | { readonly kind: 'file'; readonly path: string }
  /** An unpacked extension folder. */
  | { readonly kind: 'folder'; readonly path: string };

/** An extension unpacked and patched but not yet installed: what the user agrees to. */
export interface ExtensionInstallPreview {
  readonly stagingId: string;
  readonly extension: Omit<BrowserExtensionInfo, 'enabled' | 'installedAt'>;
  /** The version already installed under the same id, which committing replaces. */
  readonly replaces: string | null;
  /** Permissions the launcher's browser cannot honour; those parts of the extension will not work. */
  readonly unsupported: readonly string[];
}

export type ExtensionErrorCode =
  | 'bad_input'
  | 'download_failed'
  | 'bad_package'
  | 'bad_manifest'
  | 'unsupported_manifest'
  | 'too_large'
  | 'not_found'
  | 'io';

export type ExtensionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExtensionErrorCode; readonly message?: string };

/** A toolbar button opens one of these pages of an installed extension. */
export type ExtensionPage = 'popup' | 'options';
