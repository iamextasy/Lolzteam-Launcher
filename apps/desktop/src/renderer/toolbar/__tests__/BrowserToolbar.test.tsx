import type {
  BrowserBookmarksState,
  BrowserExtensionInfo,
  BrowserTab,
  BrowserTabsState,
} from '@shared-types';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BrowserToolbar } from '../BrowserToolbar';
import { isBlankUrl } from '../TabStrip';
import type { BrowserNavBridge, NavState } from '../bridge';
import { L } from '../strings';

const page = (over: Partial<NavState> = {}): NavState => ({
  url: 'https://example.test/',
  canGoBack: true,
  canGoForward: false,
  isLoading: false,
  title: 'Example',
  ...over,
});

/** A tab with a page shows it; a blank one never is `ready`. */
const tab = (id: number, url: string, over: Partial<BrowserTab> = {}): BrowserTab => ({
  id,
  title: '',
  url,
  favicon: null,
  isLoading: false,
  ready: !isBlankUrl(url),
  adopted: false,
  ...over,
});

/** An extension with a popup: enough to put the extensions menu on the toolbar. */
const extension = (): BrowserExtensionInfo => ({
  id: 'a'.repeat(32),
  name: 'Example extension',
  version: '1.0.0',
  description: '',
  enabled: true,
  source: 'file',
  manifestVersion: 3,
  permissions: [],
  hostPermissions: [],
  hasPopup: true,
  hasOptions: false,
  icon: null,
  installedAt: 0,
});

/** The toolbar bridge, each call a spy; `show` plays main's navigation state, `showTabs` its tab list. */
const setup = () => {
  let listener: ((state: NavState) => void) | null = null;
  let tabsListener: ((state: BrowserTabsState) => void) | null = null;
  const call = () => vi.fn(async () => undefined);
  const off = () => () => undefined;
  const api = {
    back: call(),
    forward: call(),
    reload: call(),
    stop: call(),
    go: call(),
    expand: call(),
    collapse: call(),
    tabNew: call(),
    tabClose: call(),
    tabActivate: call(),
    bookmarkOpen: call(),
    onState: vi.fn((cb: (state: NavState) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    onTabs: vi.fn((cb: (state: BrowserTabsState) => void) => {
      tabsListener = cb;
      return () => {
        tabsListener = null;
      };
    }),
    onBookmarks: off,
    onFocusAddress: off,
    onExtensions: off,
  };
  window.browserNav = api as unknown as BrowserNavBridge;
  const show = (state: NavState): void => act(() => listener?.(state));
  const showTabs = (state: BrowserTabsState): void => act(() => tabsListener?.(state));
  return { api, show, showTabs };
};

describe('BrowserToolbar', () => {
  it('stops a load on Esc with the focus anywhere in it but the address bar', async () => {
    const user = userEvent.setup();
    const { api, show } = setup();
    render(<BrowserToolbar />);
    show(page({ isLoading: true }));

    // After a click on Back the keyboard is in the toolbar, where main leaves Esc to it.
    screen.getByRole('button', { name: L.back }).focus();
    await user.keyboard('{Escape}');
    expect(api.stop).toHaveBeenCalledTimes(1);

    // In the address bar Esc drops the edit, and the load goes on.
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Escape}');
    expect(api.stop).toHaveBeenCalledTimes(1);

    // Nothing loading: nothing to stop.
    show(page());
    screen.getByRole('button', { name: L.back }).focus();
    await user.keyboard('{Escape}');
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('shows a new tab an empty address bar, focused for typing', () => {
    const { show, showTabs } = setup();
    render(<BrowserToolbar />);
    const input = screen.getByRole('textbox');

    // The window's first tab is its landing page on its way: nothing to type yet.
    showTabs({ tabs: [tab(1, '')], activeId: 1 });
    show(page());
    expect(input).not.toHaveFocus();
    expect(input).toHaveValue('https://example.test/');

    // "+": the new tab is active before its state has come.
    showTabs({ tabs: [tab(1, 'https://example.test/'), tab(2, 'about:blank')], activeId: 2 });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    show(page({ url: 'about:blank', title: '', canGoBack: false }));
    expect(input).toHaveValue('');
    // Its own updates (title, loading) do not wipe what is being typed.
    act(() => {
      input.focus();
    });
    showTabs({
      tabs: [tab(1, 'https://example.test/'), tab(2, 'about:blank', { title: 'about:blank' })],
      activeId: 2,
    });
    expect(input).toHaveFocus();
  });

  it('shows about:blank as an empty address bar', () => {
    const { show } = setup();
    render(<BrowserToolbar />);
    show(page({ url: 'about:blank' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByRole('button', { name: L.bookmarkAdd })).toBeNull();
  });

  it('shows the address of a tab a link opened once its page commits', () => {
    const { show, showTabs } = setup();
    render(<BrowserToolbar />);
    const input = screen.getByRole('textbox');
    showTabs({ tabs: [tab(1, 'https://example.test/')], activeId: 1 });
    show(page());

    // A link opened in a new tab has no URL until its navigation commits.
    showTabs({
      tabs: [tab(1, 'https://example.test/'), tab(2, '', { isLoading: true })],
      activeId: 2,
    });
    expect(input).toHaveFocus();
    showTabs({
      tabs: [tab(1, 'https://example.test/'), tab(2, 'https://example.test/next')],
      activeId: 2,
    });
    show(page({ url: 'https://example.test/next' }));
    expect(input).not.toHaveFocus();
    expect(input).toHaveValue('https://example.test/next');
  });

  it('drops an address being typed when another tab is switched to', async () => {
    const user = userEvent.setup();
    const { show, showTabs } = setup();
    render(<BrowserToolbar />);
    const input = screen.getByRole('textbox');
    showTabs({
      tabs: [tab(1, 'https://example.test/'), tab(2, 'https://example.test/b')],
      activeId: 1,
    });
    show(page());

    await user.click(input);
    await user.keyboard('half-typed');
    showTabs({
      tabs: [tab(1, 'https://example.test/'), tab(2, 'https://example.test/b')],
      activeId: 2,
    });
    show(page({ url: 'https://example.test/b' }));
    expect(input).not.toHaveFocus();
    expect(input).toHaveValue('https://example.test/b');
  });

  // The same numbers main's `chromeHeight` is pinned to (bookmarks.test.ts): the page view starts where this ends.
  it('ends its chrome where main lays the page: 88px, 120px with the bookmarks bar', () => {
    setup();
    let push: ((state: BrowserBookmarksState) => void) | null = null;
    window.browserNav.onBookmarks = (cb) => {
      push = cb;
      return () => undefined;
    };
    render(<BrowserToolbar />);
    const chromeH = () => document.documentElement.style.getPropertyValue('--chrome-h');
    expect(chromeH()).toBe('88px');

    const mark = { id: 'b1', title: 'Example', url: 'https://example.test/' };
    act(() => push?.({ bookmarks: [mark], showBar: true }));
    expect(chromeH()).toBe('120px');
    act(() => push?.({ bookmarks: [mark], showBar: false }));
    expect(chromeH()).toBe('88px');
    act(() => push?.({ bookmarks: [], showBar: true }));
    expect(chromeH()).toBe('88px');
  });

  it('closes an open menu when the tab strip is used', async () => {
    const user = userEvent.setup();
    const { api, showTabs } = setup();
    window.browserNav.onExtensions = (cb) => {
      cb([extension()]);
      return () => undefined;
    };
    render(<BrowserToolbar />);
    showTabs({
      tabs: [tab(1, 'https://example.test/'), tab(2, 'https://example.test/b')],
      activeId: 1,
    });

    await user.click(screen.getByRole('button', { name: L.extensions }));
    expect(screen.getByRole('dialog', { name: L.extensions })).toBeInTheDocument();
    await user.click(screen.getAllByRole('tab')[1] as HTMLElement);
    expect(screen.queryByRole('dialog', { name: L.extensions })).toBeNull();
    expect(api.collapse).toHaveBeenCalled();
    expect(api.tabActivate).toHaveBeenCalledWith(2);
  });

  it('covers a new tab with its page and a loading one with a placeholder, until its page is up', () => {
    const { showTabs } = setup();
    const { container } = render(<BrowserToolbar />);
    const cover = () => container.querySelector('[data-cover]');
    // Before main's first word there is no tab to stand in for.
    expect(cover()).toBeNull();

    showTabs({
      tabs: [tab(1, 'https://example.test/', { isLoading: true, ready: false })],
      activeId: 1,
    });
    expect(cover()).toHaveAttribute('data-cover', 'loading');
    expect(screen.getByRole('status')).toHaveTextContent('example.test');

    // The first page is up: gone, and later loads in the tab leave the page in view.
    showTabs({ tabs: [tab(1, 'https://example.test/', { isLoading: true })], activeId: 1 });
    expect(cover()).toBeNull();

    // "+": a new tab's page.
    showTabs({ tabs: [tab(1, 'https://example.test/'), tab(2, 'about:blank')], activeId: 2 });
    expect(cover()).toHaveAttribute('data-cover', 'newTab');
    expect(screen.getByRole('heading', { name: L.newTab })).toBeInTheDocument();

    // Back to the first tab, whose page is up.
    showTabs({ tabs: [tab(1, 'https://example.test/'), tab(2, 'about:blank')], activeId: 1 });
    expect(cover()).toBeNull();
  });

  it('puts the bookmarks on a new tab’s page, with the bar off too', async () => {
    const user = userEvent.setup();
    const { api, showTabs } = setup();
    let push: ((state: BrowserBookmarksState) => void) | null = null;
    window.browserNav.onBookmarks = (cb) => {
      push = cb;
      return () => undefined;
    };
    render(<BrowserToolbar />);
    showTabs({ tabs: [tab(1, 'about:blank')], activeId: 1 });
    expect(screen.queryByRole('navigation', { name: L.newTabBookmarks })).toBeNull();

    const mark = { id: 'b1', title: 'Example', url: 'https://example.test/' };
    act(() => push?.({ bookmarks: [mark], showBar: false }));
    const tiles = screen.getByRole('navigation', { name: L.newTabBookmarks });
    await user.click(within(tiles).getByRole('button', { name: 'Example' }));
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('b1', false);
  });

  it('keeps menus over the cover, and a click on the cover closes nothing', async () => {
    const user = userEvent.setup();
    const { api, showTabs } = setup();
    window.browserNav.onExtensions = (cb) => {
      cb([extension()]);
      return () => undefined;
    };
    const { container } = render(<BrowserToolbar />);
    showTabs({ tabs: [tab(1, 'about:blank')], activeId: 1 });
    const cover = container.querySelector('[data-cover]') as HTMLElement;

    await user.click(cover);
    expect(api.expand).not.toHaveBeenCalled();
    expect(api.collapse).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: L.extensions }));
    expect(screen.getByRole('dialog', { name: L.extensions })).toBeInTheDocument();
    // The backdrop comes after the cover in the page: it dims it, and takes the click that closes the menu.
    const backdrop = cover.nextElementSibling as HTMLElement;
    expect(backdrop).toHaveAttribute('role', 'presentation');
    await user.click(backdrop);
    expect(screen.queryByRole('dialog', { name: L.extensions })).toBeNull();
    expect(api.collapse).toHaveBeenCalledTimes(1);
    // Still the new tab under it.
    expect(container.querySelector('[data-cover]')).toBe(cover);
  });
});
