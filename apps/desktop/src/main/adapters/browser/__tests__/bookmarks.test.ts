import { type BrowserBookmark, MAX_BROWSER_BOOKMARKS } from '@shared-types';
import { describe, expect, it, vi } from 'vitest';

// `bookmarks.ts` reuses `isWebUrl`, which lives next to the one `shell` call.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));

const {
  addBookmark,
  applyFavicon,
  bookmarkTitle,
  chromeHeight,
  readBookmarkEdit,
  readBookmarkOpen,
  readBookmarks,
  removeBookmark,
  updateBookmark,
} = await import('../bookmarks');

/** Synthetic one-pixel icons: what matters is that they are image `data:` URLs, and that they differ. */
const ICON_A =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ICON_B = 'data:image/x-icon;base64,AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAA';

const mark = (n: number, url = `https://example.test/page/${n}`): BrowserBookmark => ({
  id: `bm-${n}`,
  title: `Page ${n}`,
  url,
});

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe('addBookmark', () => {
  it('appends the page with a fresh id', () => {
    const list = [mark(1)];
    const res = addBookmark(
      list,
      { url: 'https://steamcommunity.test/market/', title: 'Market' },
      ids(),
    );
    expect(res.added).toBe(true);
    expect(res.bookmark).toEqual({
      id: 'new-1',
      title: 'Market',
      url: 'https://steamcommunity.test/market/',
    });
    expect(res.list).toEqual([mark(1), res.bookmark]);
    // The input is not touched: the caller saves the new list.
    expect(list).toEqual([mark(1)]);
  });

  it('answers the existing bookmark for a URL already pinned', () => {
    const list = [mark(1), mark(2)];
    const res = addBookmark(list, { url: mark(2).url, title: 'Something else' }, ids());
    expect(res.added).toBe(false);
    expect(res.bookmark).toBe(list[1]);
    expect(res.list).toBe(list);
  });

  it('refuses past the limit', () => {
    const list = Array.from({ length: MAX_BROWSER_BOOKMARKS }, (_, i) => mark(i));
    const res = addBookmark(list, { url: 'https://example.test/new', title: 'New' }, ids());
    expect(res).toEqual({ list, bookmark: null, added: false });
  });

  it('still answers a page already pinned when the bar is full', () => {
    const list = Array.from({ length: MAX_BROWSER_BOOKMARKS }, (_, i) => mark(i));
    const res = addBookmark(list, { url: mark(7).url, title: '' }, ids());
    expect(res.bookmark).toBe(list[7]);
    expect(res.added).toBe(false);
  });

  it('pins web pages only', () => {
    for (const url of [
      'about:blank',
      'file:///C:/Users/user/secret.txt',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
      'javascript:alert(1)',
      '',
    ]) {
      expect(addBookmark([], { url, title: 'x' }, ids())).toEqual({
        list: [],
        bookmark: null,
        added: false,
      });
    }
  });

  it('refuses a URL the settings would not save', () => {
    const url = `https://example.test/?q=${'a'.repeat(5000)}`;
    expect(addBookmark([], { url, title: 'Long' }, ids()).bookmark).toBeNull();
  });

  it('takes the page’s favicon along, but only one the settings would save', () => {
    const page = { url: 'https://example.test/', title: 'Example' };
    expect(addBookmark([], { ...page, icon: ICON_A }, ids()).bookmark?.icon).toBe(ICON_A);
    expect(addBookmark([], { ...page, icon: null }, ids()).bookmark).not.toHaveProperty('icon');
    for (const icon of ['https://example.test/favicon.ico', 'data:text/html;base64,PGI+', '']) {
      expect(addBookmark([], { ...page, icon }, ids()).bookmark).not.toHaveProperty('icon');
    }
  });
});

describe('updateBookmark', () => {
  const withIcon = (b: BrowserBookmark, icon = ICON_A): BrowserBookmark => ({ ...b, icon });

  it('renames and moves one bookmark in place', () => {
    const list = [mark(1), mark(2), mark(3)];
    const res = updateBookmark(list, {
      id: 'bm-2',
      title: '  Market  ',
      url: 'https://example.test/market',
    });
    expect(res.changed).toBe(true);
    expect(res.bookmark).toEqual({
      id: 'bm-2',
      title: 'Market',
      url: 'https://example.test/market',
    });
    expect(res.list).toEqual([mark(1), res.bookmark, mark(3)]);
    expect(list).toEqual([mark(1), mark(2), mark(3)]);
  });

  it('spells the address as the browser does, and gives a bare domain https://', () => {
    expect(
      updateBookmark([mark(1)], { id: 'bm-1', title: 'x', url: ' HTTPS://Example.TEST ' }).bookmark
        ?.url,
    ).toBe('https://example.test/');
    expect(
      updateBookmark([mark(1)], { id: 'bm-1', title: 'x', url: 'shop.example.test/a' }).bookmark
        ?.url,
    ).toBe('https://shop.example.test/a');
  });

  it('names an emptied title by the host and clips a long one', () => {
    const list = [mark(1)];
    expect(
      updateBookmark(list, { id: 'bm-1', title: '  ', url: mark(1).url }).bookmark?.title,
    ).toBe('example.test');
    expect(
      updateBookmark(list, { id: 'bm-1', title: `${'x'.repeat(199)}😀`, url: mark(1).url }).bookmark
        ?.title,
    ).toBe('x'.repeat(199));
  });

  it('keeps the icon while the site stays the same, and drops it for another site', () => {
    const list = [withIcon(mark(1))];
    const samesite = updateBookmark(list, {
      id: 'bm-1',
      title: 'Other page',
      url: 'https://example.test/other?x=1',
    });
    expect(samesite.bookmark?.icon).toBe(ICON_A);
    const moved = updateBookmark(list, { id: 'bm-1', title: 'Moved', url: 'https://other.test/' });
    expect(moved.changed).toBe(true);
    expect(moved.bookmark).toEqual({ id: 'bm-1', title: 'Moved', url: 'https://other.test/' });
    // Another scheme or port is another origin, and so another site's icon.
    const http = updateBookmark(list, {
      id: 'bm-1',
      title: 'x',
      url: 'http://example.test/page/1',
    });
    expect(http.bookmark).not.toHaveProperty('icon');
  });

  it('answers the same list when nothing changed', () => {
    const list = [withIcon(mark(1)), mark(2)];
    const res = updateBookmark(list, { id: 'bm-1', title: 'Page 1', url: mark(1).url });
    expect(res).toEqual({ list, bookmark: list[0], changed: false });
    expect(res.list).toBe(list);
  });

  it('refuses another bookmark’s address, but not the bookmark’s own', () => {
    const list = [mark(1), mark(2)];
    expect(updateBookmark(list, { id: 'bm-1', title: 'x', url: mark(2).url })).toEqual({
      list,
      bookmark: null,
      changed: false,
    });
    expect(updateBookmark(list, { id: 'bm-2', title: 'Renamed', url: mark(2).url }).changed).toBe(
      true,
    );
  });

  it('refuses what is not a web address, and an id that is not there', () => {
    const list = [mark(1)];
    for (const url of [
      'file:///C:/Users/user/secret.txt',
      'javascript:alert(1)',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
      'steam://run/730',
      'market',
      'two words',
      '',
      `https://example.test/?q=${'a'.repeat(5000)}`,
    ]) {
      expect(updateBookmark(list, { id: 'bm-1', title: 'x', url }).bookmark).toBeNull();
    }
    expect(updateBookmark(list, { id: 'bm-9', title: 'x', url: 'https://example.test/' })).toEqual({
      list,
      bookmark: null,
      changed: false,
    });
  });

  it('survives a malformed payload from the toolbar', () => {
    const list = [mark(1)];
    const bad = { id: 'bm-1', title: 5, url: null } as unknown as Parameters<
      typeof updateBookmark
    >[1];
    expect(updateBookmark(list, bad).bookmark).toBeNull();
    const noTitle = { id: 'bm-1', url: 'https://example.test/x' } as unknown as Parameters<
      typeof updateBookmark
    >[1];
    expect(updateBookmark(list, noTitle).bookmark?.title).toBe('example.test');
  });
});

describe('applyFavicon', () => {
  it('sets the icon on the bookmark of the loaded page', () => {
    const list = [mark(1), mark(2)];
    const res = applyFavicon(list, mark(2).url, ICON_A);
    expect(res.changed).toBe(true);
    expect(res.list).toEqual([mark(1), { ...mark(2), icon: ICON_A }]);
    expect(list).toEqual([mark(1), mark(2)]);
  });

  it('matches the same origin and path, trailing slash, query and hash aside', () => {
    const list = [
      mark(1, 'https://example.test/market/'),
      mark(2, 'https://example.test/market?tab=1'),
      mark(3, 'https://example.test/'),
      mark(4, 'https://example.test'),
      mark(5, 'https://example.test/market/steam'),
      mark(6, 'http://example.test/market'),
      mark(7, 'https://shop.example.test/market'),
    ];
    const hit = (pageUrl: string) =>
      applyFavicon(list, pageUrl, ICON_A)
        .list.filter((b) => b.icon === ICON_A)
        .map((b) => b.id);
    expect(hit('https://example.test/market')).toEqual(['bm-1', 'bm-2']);
    expect(hit('https://example.test/market/#top')).toEqual(['bm-1', 'bm-2']);
    expect(hit('https://example.test/')).toEqual(['bm-3', 'bm-4']);
  });

  it('leaves the list alone when the icon is already there, or nothing matches', () => {
    const list = [{ ...mark(1), icon: ICON_A }, mark(2)];
    const same = applyFavicon(list, mark(1).url, ICON_A);
    expect(same).toEqual({ list, changed: false });
    expect(same.list).toBe(list);
    expect(applyFavicon(list, 'https://elsewhere.test/', ICON_A).list).toBe(list);
  });

  it('replaces a different icon', () => {
    const list = [{ ...mark(1), icon: ICON_A }];
    expect(applyFavicon(list, mark(1).url, ICON_B).list[0]?.icon).toBe(ICON_B);
  });

  it('refuses an icon the settings would not save, and a page that is not on the web', () => {
    const list = [mark(1)];
    const huge = `data:image/png;base64,${'A'.repeat(70_000)}`;
    for (const icon of [huge, 'https://example.test/favicon.ico', 'data:image/png,raw', '']) {
      expect(applyFavicon(list, mark(1).url, icon)).toEqual({ list, changed: false });
    }
    expect(applyFavicon(list, 'about:blank', ICON_A)).toEqual({ list, changed: false });
  });
});

describe('bookmarkTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(bookmarkTitle('  Steam \n Community  ', 'https://example.test/')).toBe(
      'Steam Community',
    );
  });

  it('names an untitled page by its host', () => {
    expect(bookmarkTitle('', 'https://www.example.test/a/b')).toBe('example.test');
    expect(bookmarkTitle('   ', 'https://shop.example.test/')).toBe('shop.example.test');
  });

  it('caps the title at 200 without splitting a character', () => {
    expect(bookmarkTitle('x'.repeat(500), 'https://example.test/')).toHaveLength(200);
    const emoji = `${'x'.repeat(199)}😀tail`;
    const clipped = bookmarkTitle(emoji, 'https://example.test/');
    expect(clipped).toBe('x'.repeat(199));
  });
});

describe('removeBookmark', () => {
  it('drops the one id', () => {
    expect(removeBookmark([mark(1), mark(2), mark(3)], 'bm-2')).toEqual([mark(1), mark(3)]);
  });

  it('hands back the same list when there is nothing to drop', () => {
    const list = [mark(1)];
    expect(removeBookmark(list, 'bm-9')).toBe(list);
  });
});

describe('readBookmarks', () => {
  it('keeps only usable entries from whatever the settings file holds', () => {
    const raw = [
      mark(1),
      { id: '', title: 'no id', url: 'https://example.test/' },
      { id: 'x', title: 3, url: 'https://example.test/' },
      { id: 'y', title: 'local file', url: 'file:///etc/passwd' },
      null,
      'https://example.test/',
      mark(2),
    ];
    expect(readBookmarks(raw)).toEqual([mark(1), mark(2)]);
  });

  it('drops an icon the settings would refuse, and keeps the bookmark', () => {
    const raw = [
      { ...mark(1), icon: ICON_A },
      { ...mark(2), icon: 'https://example.test/favicon.ico' },
      { ...mark(3), icon: 42 },
    ];
    expect(readBookmarks(raw)).toEqual([{ ...mark(1), icon: ICON_A }, mark(2), mark(3)]);
  });

  it('reads a missing or broken list as empty', () => {
    expect(readBookmarks(undefined)).toEqual([]);
    expect(readBookmarks(null)).toEqual([]);
    expect(readBookmarks({ 0: mark(1) })).toEqual([]);
  });
});

// The toolbar's mirror of these numbers is pinned to the same values in renderer/toolbar/__tests__/BrowserToolbar.test.tsx.
describe('chromeHeight', () => {
  it('is the tabs and the toolbar without bookmarks or with the bar off', () => {
    expect(chromeHeight([], true)).toBe(88);
    expect(chromeHeight([mark(1)], false)).toBe(88);
  });

  it('adds the bookmarks bar when it has anything to show', () => {
    expect(chromeHeight([mark(1)], true)).toBe(120);
  });
});

describe('readBookmarkOpen', () => {
  it("reads the toolbar's request, a new tab only when asked for in so many words", () => {
    expect(readBookmarkOpen({ id: 'bm-1', newTab: true })).toEqual({ id: 'bm-1', newTab: true });
    expect(readBookmarkOpen({ id: 'bm-1', newTab: false })).toEqual({ id: 'bm-1', newTab: false });
    expect(readBookmarkOpen({ id: 'bm-1' })).toEqual({ id: 'bm-1', newTab: false });
    expect(readBookmarkOpen({ id: 'bm-1', newTab: 'yes' })).toEqual({ id: 'bm-1', newTab: false });
  });

  it('takes a bare id, as a toolbar from before the tabs sends it, for the active tab', () => {
    expect(readBookmarkOpen('bm-1')).toEqual({ id: 'bm-1', newTab: false });
  });

  it('refuses anything else', () => {
    expect(readBookmarkOpen(undefined)).toBeNull();
    expect(readBookmarkOpen(null)).toBeNull();
    expect(readBookmarkOpen(7)).toBeNull();
    expect(readBookmarkOpen({ id: 7, newTab: true })).toBeNull();
  });
});

describe('readBookmarkEdit', () => {
  it('passes on the three strings, nothing more', () => {
    expect(
      readBookmarkEdit({ id: 'bm-1', title: 'T', url: 'https://example.test/', icon: 'x' }),
    ).toEqual({ id: 'bm-1', title: 'T', url: 'https://example.test/' });
  });

  it('refuses a payload of another shape', () => {
    expect(readBookmarkEdit(null)).toBeNull();
    expect(readBookmarkEdit('bm-1')).toBeNull();
    expect(readBookmarkEdit({ id: 'bm-1', title: 'T' })).toBeNull();
    expect(readBookmarkEdit({ id: 'bm-1', title: 1, url: 'https://example.test/' })).toBeNull();
  });
});
