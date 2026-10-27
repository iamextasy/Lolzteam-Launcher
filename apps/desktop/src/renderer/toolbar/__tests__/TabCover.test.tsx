import type { BrowserBookmark, BrowserTab } from '@shared-types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoadingCover, MAX_TILES, NewTabPage, TabCover, coverFor } from '../TabCover';
import type { BrowserNavBridge } from '../bridge';
import { L } from '../strings';

/** The platform main passed in, settable per test. */
const platform = vi.hoisted(() => ({ mac: false }));
vi.mock('../strings', async (importActual) => {
  const actual = await importActual<typeof import('../strings')>();
  return {
    ...actual,
    get IS_MAC() {
      return platform.mac;
    },
  };
});

/** A 1×1 PNG: what a fetched favicon looks like to the toolbar. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const tab = (over: Partial<BrowserTab> = {}): BrowserTab => ({
  id: 1,
  title: '',
  url: 'https://example.test/',
  favicon: null,
  isLoading: false,
  ready: true,
  adopted: false,
  ...over,
});

const mark = (n: number, over: Partial<BrowserBookmark> = {}): BrowserBookmark => ({
  id: `bm-${n}`,
  title: `Site ${n}`,
  url: `https://site${n}.example.test/`,
  ...over,
});

const setup = () => {
  const api = { bookmarkOpen: vi.fn(async () => undefined) };
  window.browserNav = api as unknown as BrowserNavBridge;
  return api;
};

const middleClick = (el: Element): void => {
  fireEvent.mouseDown(el, { button: 1 });
  fireEvent(el, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
};

const tiles = (): HTMLElement[] =>
  within(screen.getByRole('navigation', { name: L.newTabBookmarks })).getAllByRole('button');

/** The disc a tile draws its favicon or letter in. */
const face = (tile: HTMLElement | undefined): Element | null =>
  tile?.querySelector('span[aria-hidden]') ?? null;

describe('coverFor', () => {
  it('covers a blank tab with the new tab page, while it loads its blank page too', () => {
    expect(coverFor(tab({ url: 'about:blank', ready: false }))).toBe('newTab');
    expect(coverFor(tab({ url: '', ready: false }))).toBe('newTab');
    expect(coverFor(tab({ url: 'about:blank', ready: false, isLoading: true }))).toBe('newTab');
  });

  it('covers a tab on its way to its first page with the loading placeholder', () => {
    expect(coverFor(tab({ ready: false, isLoading: true }))).toBe('loading');
    // Committed, not yet drawn.
    expect(coverFor(tab({ ready: false }))).toBe('loading');
    // A link's tab once its page has committed, as main covers it.
    expect(coverFor(tab({ ready: false, adopted: true }))).toBe('loading');
  });

  it('leaves a link’s blank tab uncovered, as main does: its opener may write into it', () => {
    expect(coverFor(tab({ url: '', ready: false, adopted: true, isLoading: true }))).toBeNull();
    expect(coverFor(tab({ url: 'about:blank', ready: false, adopted: true }))).toBeNull();
  });

  it('uncovers a tab once it is ready, and for good: its next loads keep the page up', () => {
    expect(coverFor(tab())).toBeNull();
    expect(coverFor(tab({ isLoading: true }))).toBeNull();
    expect(coverFor(null)).toBeNull();
  });
});

describe('NewTabPage', () => {
  it('names itself and draws a tile per bookmark, the favicon or the letter', () => {
    setup();
    render(<NewTabPage bookmarks={[mark(1, { icon: PNG }), mark(2, { title: '' })]} />);
    expect(screen.getByRole('heading', { name: L.newTab })).toBeInTheDocument();
    expect(screen.getByText(L.newTabHint)).toBeInTheDocument();

    const [withIcon, withLetter] = tiles();
    expect(withIcon).toHaveAccessibleName('Site 1');
    expect(withIcon?.querySelector('img')).toHaveAttribute('src', PNG);
    // No title: the site's name; no favicon: its first letter.
    expect(withLetter).toHaveAccessibleName('site2.example.test');
    expect(withLetter?.querySelector('img')).toBeNull();
    expect(face(withLetter)).toHaveTextContent('S');
  });

  it('falls back to the letter when the favicon will not draw', () => {
    setup();
    render(<NewTabPage bookmarks={[mark(1, { icon: PNG })]} />);
    const img = tiles()[0]?.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(tiles()[0]?.querySelector('img')).toBeNull();
    expect(face(tiles()[0])).toHaveTextContent('S');
  });

  it(`shows at most ${MAX_TILES} bookmarks`, () => {
    setup();
    render(<NewTabPage bookmarks={Array.from({ length: MAX_TILES + 3 }, (_, i) => mark(i))} />);
    expect(tiles()).toHaveLength(MAX_TILES);
  });

  it('has no tiles, and does not mention bookmarks, without any', () => {
    setup();
    render(<NewTabPage bookmarks={[]} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByText(L.newTabHintNoBookmarks)).toBeInTheDocument();
  });

  it('opens a bookmark here on a click, in a new tab on a middle or Ctrl click', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<NewTabPage bookmarks={[mark(1), mark(2)]} />);
    const [first, second] = tiles();

    await user.click(first as HTMLElement);
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-1', false);
    middleClick(second as HTMLElement);
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-2', true);
    await user.keyboard('{Control>}');
    await user.click(first as HTMLElement);
    await user.keyboard('{/Control}');
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-1', true);
    expect(api.bookmarkOpen).toHaveBeenCalledTimes(3);
  });

  it('opens a new tab on ⌘-click on a Mac, where Ctrl-click is a right click', async () => {
    platform.mac = true;
    try {
      const user = userEvent.setup();
      const api = setup();
      render(<NewTabPage bookmarks={[mark(1)]} />);
      await user.keyboard('{Meta>}');
      await user.click(tiles()[0] as HTMLElement);
      await user.keyboard('{/Meta}');
      expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-1', true);
    } finally {
      platform.mac = false;
    }
  });
});

describe('LoadingCover', () => {
  it('names the site on the way and says it is loading', () => {
    render(<LoadingCover url="https://www.example.test/some/page?q=1" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(L.loading);
    expect(within(status).getByText('example.test')).toBeInTheDocument();
  });

  it('has no site to name for a tab with no address yet', () => {
    render(<LoadingCover url="" />);
    expect(screen.getByRole('status')).toHaveTextContent(new RegExp(`^${L.loading}$`));
  });
});

describe('TabCover', () => {
  it('draws nothing over a page that is up', () => {
    const { container } = render(<TabCover tab={tab()} bookmarks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws the new tab page or the loading placeholder', () => {
    setup();
    const { rerender } = render(
      <TabCover tab={tab({ url: 'about:blank', ready: false })} bookmarks={[mark(1)]} />,
    );
    expect(screen.getByRole('heading', { name: L.newTab })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<TabCover tab={tab({ ready: false, isLoading: true })} bookmarks={[mark(1)]} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('example.test');
  });

  it('keeps the new tab page up while the blank page under it loads — no blink', () => {
    setup();
    const blank = tab({ url: 'about:blank', ready: false });
    const { rerender } = render(<TabCover tab={blank} bookmarks={[mark(1)]} />);
    const heading = screen.getByRole('heading', { name: L.newTab });
    rerender(<TabCover tab={{ ...blank, isLoading: true }} bookmarks={[mark(1)]} />);
    rerender(<TabCover tab={blank} bookmarks={[mark(1)]} />);
    // The same page, never unmounted in between.
    expect(screen.getByRole('heading', { name: L.newTab })).toBe(heading);
  });

  it('draws no tiles over a link’s blank tab, where main lays out no cover', () => {
    setup();
    const { container } = render(
      <TabCover tab={tab({ url: '', ready: false, adopted: true })} bookmarks={[mark(1)]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
