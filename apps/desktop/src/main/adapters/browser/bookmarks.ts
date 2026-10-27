import {
  type BookmarkEdit,
  type BrowserBookmark,
  MAX_BOOKMARK_ICON_CHARS,
  MAX_BROWSER_BOOKMARKS,
} from '@shared-types';
import { isWebUrl } from './guards';

/** The tab strip, on top of everything. */
export const TABS_H = 40;
/** The toolbar row: back/forward/reload, the address bar and the buttons. */
export const TOOLBAR_H = 48;
/** The bookmarks bar under it. */
export const BOOKMARKS_BAR_H = 32;

/** The same limits `settings-patch` holds the list to: an entry past them would sink every later save of the list. */
const TITLE_MAX = 200;
const URL_MAX = 4096;

/** Height of the window's chrome: the tabs, the toolbar, and the bookmarks bar when it is on and has anything to show. */
export const chromeHeight = (bookmarks: readonly BrowserBookmark[], showBar: boolean): number =>
  TABS_H + TOOLBAR_H + (showBar && bookmarks.length > 0 ? BOOKMARKS_BAR_H : 0);

/** What `settings-patch` takes for an icon: an image `data:` URL, never a link the toolbar would have to fetch. */
export const isBookmarkIcon = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= MAX_BOOKMARK_ICON_CHARS &&
  /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(v);

const isBookmark = (v: unknown): v is BrowserBookmark => {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    b.id !== '' &&
    typeof b.title === 'string' &&
    typeof b.url === 'string' &&
    isWebUrl(b.url)
  );
};

/** The entry without an icon `settings-patch` would refuse — the bookmark itself is still good. */
const withSavableIcon = (b: BrowserBookmark): BrowserBookmark => {
  if (b.icon === undefined || isBookmarkIcon(b.icon)) return b;
  const { icon: _dropped, ...rest } = b;
  return rest;
};

/** Settings are validated on save, not on load: whatever in the file is not a usable bookmark is not one. */
export const readBookmarks = (raw: unknown): readonly BrowserBookmark[] =>
  Array.isArray(raw) ? raw.filter(isBookmark).map(withSavableIcon) : [];

/** `TITLE_MAX` UTF-16 units, without leaving half an emoji at the cut. */
const clip = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

/** The page's title as the bar shows it; a page without one is named by its host. */
export const bookmarkTitle = (title: string, url: string): string => {
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (trimmed) return clip(trimmed, TITLE_MAX);
  try {
    return clip(new URL(url).hostname.replace(/^www\./, ''), TITLE_MAX);
  } catch {
    return '';
  }
};

/**
 * An address typed into the bookmark editor, as a bookmark holds it — the rule the settings page's
 * `normalizeBookmarkUrl` follows: `http:`/`https:` only, a bare domain gets `https://`, and the browser's
 * own spelling (`new URL().href`), which is what the star compares the page against.
 */
const typedWebUrl = (raw: string): string | null => {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const explicit = /^https?:\/\//i.test(value);
  // Any other scheme (`file:`, `javascript:`, `steam:`) is refused; `host:8080` is not a scheme.
  if (!explicit && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(explicit ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Typed without a scheme, a single word is more likely a slip than an intranet host.
  if (!explicit && !url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href.length <= URL_MAX ? url.href : null;
};

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * A bookmark's page for favicon matching: origin and path, the trailing slash aside. Query and hash do not change a
 * site's icon. Two URLs with one key match the same bookmarks — the tabs send a page's icon once per key.
 */
export const pageKey = (url: string): string | null => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
};

export interface AddBookmarkResult {
  readonly list: readonly BrowserBookmark[];
  /** The page's bookmark — new, or the one already pinned to the same URL; `null` when it cannot be pinned. */
  readonly bookmark: BrowserBookmark | null;
  /** Whether `list` is new and has to be saved. */
  readonly added: boolean;
}

/** Pins a page: once per URL, web pages only, and no more than `MAX_BROWSER_BOOKMARKS`. A new bookmark takes the page's favicon along. */
export const addBookmark = (
  list: readonly BrowserBookmark[],
  page: { readonly url: string; readonly title: string; readonly icon?: string | null },
  newId: () => string,
): AddBookmarkResult => {
  const pinnable = isWebUrl(page.url) && page.url.length <= URL_MAX;
  if (!pinnable) return { list, bookmark: null, added: false };
  const existing = list.find((b) => b.url === page.url);
  if (existing) return { list, bookmark: existing, added: false };
  if (list.length >= MAX_BROWSER_BOOKMARKS) return { list, bookmark: null, added: false };
  const bookmark: BrowserBookmark = {
    id: newId(),
    title: bookmarkTitle(page.title, page.url),
    url: page.url,
    ...(isBookmarkIcon(page.icon) ? { icon: page.icon } : {}),
  };
  return { list: [...list, bookmark], bookmark, added: true };
};

export interface UpdateBookmarkResult {
  readonly list: readonly BrowserBookmark[];
  /** The bookmark as it now is; `null` when the edit is refused: no such id, not a web address, or another bookmark's URL. */
  readonly bookmark: BrowserBookmark | null;
  /** Whether `list` is new and has to be saved. */
  readonly changed: boolean;
}

/**
 * The editor's title and address for one bookmark, in place. The title is clipped, or named by the host when
 * empty, as a pinned page's is; the icon stays while the site does (same origin) — another site's would be a lie.
 */
export const updateBookmark = (
  list: readonly BrowserBookmark[],
  edit: BookmarkEdit,
): UpdateBookmarkResult => {
  const refused: UpdateBookmarkResult = { list, bookmark: null, changed: false };
  const current = list.find((b) => b.id === edit.id);
  const url = typeof edit.url === 'string' ? typedWebUrl(edit.url) : null;
  if (!current || !url) return refused;
  if (list.some((b) => b.id !== current.id && b.url === url)) return refused;

  const title = bookmarkTitle(typeof edit.title === 'string' ? edit.title : '', url);
  const keepIcon = current.icon !== undefined && originOf(current.url) === originOf(url);
  if (title === current.title && url === current.url && (keepIcon || current.icon === undefined)) {
    return { list, bookmark: current, changed: false };
  }
  const bookmark: BrowserBookmark = {
    id: current.id,
    title,
    url,
    ...(keepIcon && current.icon !== undefined ? { icon: current.icon } : {}),
  };
  return { list: list.map((b) => (b === current ? bookmark : b)), bookmark, changed: true };
};

/**
 * A loaded page's favicon onto the bookmarks that point at it — the same URL, or the same origin and path give or
 * take the trailing slash — where it is not already theirs. The same list when nothing changed.
 */
export const applyFavicon = (
  list: readonly BrowserBookmark[],
  pageUrl: string,
  icon: string,
): { readonly list: readonly BrowserBookmark[]; readonly changed: boolean } => {
  const key = pageKey(pageUrl);
  if (!key || !isBookmarkIcon(icon)) return { list, changed: false };
  let changed = false;
  const next = list.map((b) => {
    if (b.icon === icon || (b.url !== pageUrl && pageKey(b.url) !== key)) return b;
    changed = true;
    return { ...b, icon };
  });
  return changed ? { list: next, changed } : { list, changed };
};

/** What the bookmark editor sent, if it is the shape of one: `updateBookmark` validates the values themselves. */
export const readBookmarkEdit = (raw: unknown): BookmarkEdit | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, title, url } = raw as Record<string, unknown>;
  return typeof id === 'string' && typeof title === 'string' && typeof url === 'string'
    ? { id, title, url }
    : null;
};

/** `{ id, newTab }`; a bare id — a toolbar from before the tabs — opens in the active tab, as it did. */
export const readBookmarkOpen = (raw: unknown): { id: string; newTab: boolean } | null => {
  if (typeof raw === 'string') return { id: raw, newTab: false };
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, newTab } = raw as Record<string, unknown>;
  return typeof id === 'string' ? { id, newTab: newTab === true } : null;
};

/** The list without `id`; the same array when there was nothing to remove. */
export const removeBookmark = (
  list: readonly BrowserBookmark[],
  id: string,
): readonly BrowserBookmark[] =>
  list.some((b) => b.id === id) ? list.filter((b) => b.id !== id) : list;
