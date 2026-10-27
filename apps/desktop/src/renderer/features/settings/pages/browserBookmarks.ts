import { type BrowserBookmark, MAX_BROWSER_BOOKMARKS } from '@shared-types';

/** The limits `settings-patch` holds every entry to — past them the whole list would not save. */
export const BOOKMARK_TITLE_MAX = 200;
const URL_MAX = 4096;

/**
 * The address the user typed, as a bookmark can hold it: `http:`/`https:` only, a bare domain
 * gets `https://`, and the result is the browser's own spelling of it (`new URL().href`), the
 * form the star in the address bar compares against. `null` when it is not a web address.
 */
export const normalizeBookmarkUrl = (raw: string): string | null => {
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

export type BookmarkDraftError = 'url' | 'duplicate' | 'full';

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * The bookmark with a new title and address. Its icon stays while the site does (same origin) — another site's
 * icon would be a lie; without one, the bar shows the letter until the new page is visited. Main's
 * `updateBookmark` holds the toolbar's editor to the same rule.
 */
const edited = (b: BrowserBookmark, title: string, url: string): BrowserBookmark => {
  const { icon, ...rest } = b;
  return icon !== undefined && originOf(b.url) === originOf(url)
    ? { ...rest, title, url, icon }
    : { ...rest, title, url };
};

/**
 * The list after the add/edit form is saved, or why it cannot be: not a web address, a page
 * already on the bar, or no room left. An empty title is fine — the bar names the site by its host.
 */
export const applyBookmarkDraft = (
  list: readonly BrowserBookmark[],
  draft: { readonly title: string; readonly url: string },
  editingId: string | null,
  newId: () => string,
): { ok: true; list: BrowserBookmark[] } | { ok: false; error: BookmarkDraftError } => {
  const url = normalizeBookmarkUrl(draft.url);
  if (!url) return { ok: false, error: 'url' };
  if (list.some((b) => b.url === url && b.id !== editingId))
    return { ok: false, error: 'duplicate' };
  // Cut at the limit, but not through the middle of an emoji.
  const title = draft.title
    .trim()
    .slice(0, BOOKMARK_TITLE_MAX)
    .replace(/[\uD800-\uDBFF]$/, '');
  if (editingId !== null) {
    return { ok: true, list: list.map((b) => (b.id === editingId ? edited(b, title, url) : b)) };
  }
  if (list.length >= MAX_BROWSER_BOOKMARKS) return { ok: false, error: 'full' };
  return { ok: true, list: [...list, { id: newId(), title, url }] };
};

/** The list with one entry moved to another place; `null` when there is nothing to move. */
export const moveBookmark = (
  list: readonly BrowserBookmark[],
  from: number,
  to: number,
): BrowserBookmark[] | null => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(to, 0, moved);
  return next;
};
