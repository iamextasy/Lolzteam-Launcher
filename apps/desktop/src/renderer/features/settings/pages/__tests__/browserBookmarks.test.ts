import { type BrowserBookmark, MAX_BROWSER_BOOKMARKS } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { applyBookmarkDraft, moveBookmark, normalizeBookmarkUrl } from '../browserBookmarks';

const mark = (n: number, url = `https://example.test/page/${n}`): BrowserBookmark => ({
  id: `bm-${n}`,
  title: `Page ${n}`,
  url,
});

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe('normalizeBookmarkUrl', () => {
  it('keeps http and https, in the browser’s own spelling', () => {
    expect(normalizeBookmarkUrl('https://example.test')).toBe('https://example.test/');
    expect(normalizeBookmarkUrl('  HTTP://Example.TEST/a?b=1  ')).toBe('http://example.test/a?b=1');
  });

  it('gives a bare domain https://', () => {
    expect(normalizeBookmarkUrl('example.test/market')).toBe('https://example.test/market');
    expect(normalizeBookmarkUrl('example.test:8080/x')).toBe('https://example.test:8080/x');
    expect(normalizeBookmarkUrl('localhost:3000')).toBe('https://localhost:3000/');
  });

  it('refuses every other scheme', () => {
    expect(normalizeBookmarkUrl('file:///C:/Users/user/secret.txt')).toBeNull();
    expect(normalizeBookmarkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBookmarkUrl('steam://run/730')).toBeNull();
    expect(normalizeBookmarkUrl('chrome-extension://abcdefghijklmnop/popup.html')).toBeNull();
    expect(normalizeBookmarkUrl('data:text/html,<b>x</b>')).toBeNull();
  });

  it('refuses what is not an address', () => {
    expect(normalizeBookmarkUrl('')).toBeNull();
    expect(normalizeBookmarkUrl('   ')).toBeNull();
    expect(normalizeBookmarkUrl('steam market')).toBeNull();
    expect(normalizeBookmarkUrl('market')).toBeNull();
    expect(normalizeBookmarkUrl(`https://example.test/?q=${'a'.repeat(5000)}`)).toBeNull();
  });
});

describe('applyBookmarkDraft', () => {
  it('adds a bookmark at the end', () => {
    const res = applyBookmarkDraft(
      [mark(1)],
      { title: ' Market ', url: 'example.test/m' },
      null,
      ids(),
    );
    expect(res).toEqual({
      ok: true,
      list: [mark(1), { id: 'new-1', title: 'Market', url: 'https://example.test/m' }],
    });
  });

  it('keeps an empty title — the bar names the site by its host', () => {
    const res = applyBookmarkDraft([], { title: '  ', url: 'https://example.test/' }, null, ids());
    expect(res.ok && res.list[0]?.title).toBe('');
  });

  it('edits in place, keeping the id and the position', () => {
    const list = [mark(1), mark(2), mark(3)];
    const res = applyBookmarkDraft(
      list,
      { title: 'Two', url: 'https://example.test/two' },
      'bm-2',
      ids(),
    );
    expect(res).toEqual({
      ok: true,
      list: [mark(1), { id: 'bm-2', title: 'Two', url: 'https://example.test/two' }, mark(3)],
    });
  });

  it('keeps the icon while the site stays the same, and drops it for another site', () => {
    const icon = 'data:image/png;base64,iVBORw0KGgo=';
    const list = [{ ...mark(1), icon }, mark(2)];
    const samesite = applyBookmarkDraft(
      list,
      { title: 'Other', url: 'https://example.test/other' },
      'bm-1',
      ids(),
    );
    expect(samesite.ok && samesite.list[0]).toEqual({
      id: 'bm-1',
      title: 'Other',
      url: 'https://example.test/other',
      icon,
    });
    const moved = applyBookmarkDraft(list, { title: 'Moved', url: 'other.test' }, 'bm-1', ids());
    expect(moved.ok && moved.list[0]).toEqual({
      id: 'bm-1',
      title: 'Moved',
      url: 'https://other.test/',
    });
    // Another scheme is another origin.
    const http = applyBookmarkDraft(
      list,
      { title: 'x', url: 'http://example.test/page/1' },
      'bm-1',
      ids(),
    );
    expect(http.ok && http.list[0]).not.toHaveProperty('icon');
    // The others keep theirs untouched.
    expect(moved.ok && moved.list[1]).toBe(list[1]);
  });

  it('refuses a page that is already a bookmark, except the one being edited', () => {
    const list = [mark(1), mark(2)];
    expect(applyBookmarkDraft(list, { title: '', url: mark(2).url }, null, ids())).toEqual({
      ok: false,
      error: 'duplicate',
    });
    expect(applyBookmarkDraft(list, { title: '', url: mark(2).url }, 'bm-1', ids())).toEqual({
      ok: false,
      error: 'duplicate',
    });
    expect(applyBookmarkDraft(list, { title: 'Renamed', url: mark(2).url }, 'bm-2', ids()).ok).toBe(
      true,
    );
  });

  it('refuses a new one past the limit, but still edits a full list', () => {
    const list = Array.from({ length: MAX_BROWSER_BOOKMARKS }, (_, i) => mark(i));
    expect(
      applyBookmarkDraft(list, { title: '', url: 'https://example.test/new' }, null, ids()),
    ).toEqual({ ok: false, error: 'full' });
    expect(applyBookmarkDraft(list, { title: 'x', url: mark(0).url }, 'bm-0', ids()).ok).toBe(true);
  });

  it('refuses a bad address', () => {
    expect(applyBookmarkDraft([], { title: 'x', url: 'file:///etc' }, null, ids())).toEqual({
      ok: false,
      error: 'url',
    });
  });

  it('caps the title at 200 without splitting an emoji', () => {
    const long = applyBookmarkDraft(
      [],
      { title: 'x'.repeat(300), url: 'https://example.test/' },
      null,
      ids(),
    );
    expect(long.ok && long.list[0]?.title).toHaveLength(200);
    const emoji = applyBookmarkDraft(
      [],
      { title: `${'x'.repeat(199)}😀`, url: 'https://example.test/' },
      null,
      ids(),
    );
    expect(emoji.ok && emoji.list[0]?.title).toBe('x'.repeat(199));
  });
});

describe('moveBookmark', () => {
  const list = [mark(1), mark(2), mark(3)];

  it('moves one entry', () => {
    expect(moveBookmark(list, 0, 2)?.map((b) => b.id)).toEqual(['bm-2', 'bm-3', 'bm-1']);
    expect(moveBookmark(list, 2, 1)?.map((b) => b.id)).toEqual(['bm-1', 'bm-3', 'bm-2']);
  });

  it('answers null when there is nothing to move', () => {
    expect(moveBookmark(list, 1, 1)).toBeNull();
    expect(moveBookmark(list, 0, -1)).toBeNull();
    expect(moveBookmark(list, 2, 3)).toBeNull();
    expect(moveBookmark(list, -1, 0)).toBeNull();
  });
});
