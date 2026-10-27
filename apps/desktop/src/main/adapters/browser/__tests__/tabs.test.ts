import type { BrowserTabsState } from '@shared-types';
import type { BrowserWindow, WebContents } from 'electron';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabsOptions } from '../tabs';

/** A `WebContents` as far as the tabs touch it; `destroyed` comes at once, where Electron posts it. */
const fakes = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  let nextId = 100;
  class FakeContents extends EventEmitter {
    id = nextId++;
    url = '';
    title = '';
    loading = false;
    destroyed = false;
    loadURL = vi.fn((_url: string, _opts?: unknown) => Promise.resolve());
    executeJavaScriptInIsolatedWorld = vi.fn(
      (_world: number, _scripts: { code: string }[]): Promise<unknown> => Promise.resolve(null),
    );
    focus = vi.fn();
    close = vi.fn(() => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('destroyed');
    });
    getURL() {
      return this.url;
    }
    getTitle() {
      return this.title;
    }
    isLoading() {
      return this.loading;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  class FakeView {
    webContents: InstanceType<typeof FakeContents>;
    bounds: unknown = null;
    background: string | null = null;
    constructor(opts?: { webContents?: InstanceType<typeof FakeContents> }) {
      this.webContents = opts?.webContents ?? new FakeContents();
      views.push({ view: this, adopted: opts?.webContents !== undefined });
    }
    setBounds(b: unknown) {
      this.bounds = b;
    }
    setBackgroundColor(color: string) {
      this.background = color;
    }
  }
  const views: { view: FakeView; adopted: boolean }[] = [];
  return { FakeContents, FakeView, views };
});

vi.mock('electron', () => ({ WebContentsView: fakes.FakeView }));

const favicon = vi.hoisted(() => ({
  fetchFavicon:
    vi.fn<
      (
        page: string,
        candidates: readonly string[],
        proxy: unknown,
        signal?: AbortSignal,
      ) => Promise<string | null>
    >(),
  fetchPageIcon:
    vi.fn<
      (
        run: (code: string) => Promise<unknown>,
        page: string,
        ranked: readonly string[],
        signal: AbortSignal,
      ) => Promise<string | null>
    >(),
  rankFaviconUrls: vi.fn((urls: readonly string[]) => [...urls]),
}));
vi.mock('../favicons', () => favicon);

const guard = vi.hoisted(() => vi.fn());
vi.mock('../guards', () => ({
  guardWebContents: guard,
  isWebUrl: (url: string) => /^https?:\/\//i.test(url),
  isNavigableUrl: (url: string) => /^https?:\/\//i.test(url),
}));

const { CLOSED_TABS_MAX, createTabs, cycleIndex, isCovered, linkTabIndex, pushClosedTab } =
  await import('../tabs');
const { MAIN_COLORS } = await import('../../../theme');

type Contents = InstanceType<typeof fakes.FakeContents>;

describe('isCovered', () => {
  it('covers a new tab, and a tab whose first page is not ready yet', () => {
    expect(isCovered({ url: 'about:blank', ready: false, adopted: false })).toBe(true);
    expect(isCovered({ url: '', ready: false, adopted: false })).toBe(true);
    expect(isCovered({ url: 'https://example.com/', ready: false, adopted: false })).toBe(true);
    expect(isCovered({ url: 'https://example.com/', ready: false, adopted: true })).toBe(true);
  });

  it('leaves a ready page uncovered, and the blank tab a page’s link opened', () => {
    expect(isCovered({ url: 'https://example.com/', ready: true, adopted: false })).toBe(false);
    expect(isCovered({ url: '', ready: false, adopted: true })).toBe(false);
    expect(isCovered({ url: 'about:blank', ready: false, adopted: true })).toBe(false);
  });

  it('puts a new tab’s page back over a tab gone blank again', () => {
    expect(isCovered({ url: 'about:blank', ready: true, adopted: false })).toBe(true);
  });
});

describe('pushClosedTab', () => {
  it('stacks closed tabs, the last on top', () => {
    const one = pushClosedTab([], { url: 'https://a.example/', index: 0 });
    const two = pushClosedTab(one, { url: 'https://b.example/', index: 3 });
    expect(two).toEqual([
      { url: 'https://a.example/', index: 0 },
      { url: 'https://b.example/', index: 3 },
    ]);
  });

  it('has nothing to bring back of a blank tab', () => {
    const stack = [{ url: 'https://a.example/', index: 0 }];
    expect(pushClosedTab(stack, { url: 'about:blank', index: 1 })).toBe(stack);
    expect(pushClosedTab(stack, { url: '', index: 1 })).toBe(stack);
  });

  it(`keeps the last ${CLOSED_TABS_MAX}`, () => {
    let stack: ReturnType<typeof pushClosedTab> = [];
    for (let i = 0; i < CLOSED_TABS_MAX + 3; i += 1) {
      stack = pushClosedTab(stack, { url: `https://example.com/${i}`, index: i });
    }
    expect(stack).toHaveLength(CLOSED_TABS_MAX);
    expect(stack[0]?.url).toBe('https://example.com/3');
    expect(stack.at(-1)?.url).toBe(`https://example.com/${CLOSED_TABS_MAX + 2}`);
  });
});

describe('cycleIndex', () => {
  it('goes round the ends both ways', () => {
    expect(cycleIndex(3, 0, 1)).toBe(1);
    expect(cycleIndex(3, 2, 1)).toBe(0);
    expect(cycleIndex(3, 0, -1)).toBe(2);
    expect(cycleIndex(1, 0, 1)).toBe(0);
  });
});

describe('linkTabIndex', () => {
  it('puts a link’s tab after its opener and the tabs it opened before', () => {
    // Tabs: [A=1, B=2 (from A), C=3 (from A), D=4]; A opens another.
    const openers = [null, 1, 1, null];
    expect(linkTabIndex(openers, 0, 1)).toBe(3);
    // D opens one: right after it.
    expect(linkTabIndex(openers, 3, 4)).toBe(4);
    // B opens one: right after B, before C (which A opened).
    expect(linkTabIndex(openers, 1, 2)).toBe(2);
  });
});

describe('createTabs', () => {
  const win = {
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  type HookName =
    | 'onCreated'
    | 'onActivated'
    | 'onActiveChanged'
    | 'onStrip'
    | 'onPageIcon'
    | 'onEmpty';
  let hooks: { [K in HookName]: Mock<TabsOptions[K]> };
  const PROXY = { id: 'p1', host: '192.0.2.10', port: 8080 } as const;

  const make = () =>
    createTabs({
      win: win as unknown as BrowserWindow,
      partition: 'persist:lzt-account-0',
      log,
      proxy: PROXY as never,
      ...hooks,
    });
  const lastStrip = (): BrowserTabsState =>
    hooks.onStrip.mock.calls.at(-1)?.[0] as BrowserTabsState;
  const contentsOf = (wc: WebContents | null): Contents => wc as unknown as Contents;
  const loaded = (wc: Contents): string[] => wc.loadURL.mock.calls.map(([url]) => url);
  /** The guard's `openTab` for the tabs' own pages. */
  const openTabOf = (wc: WebContents) => {
    const call = guard.mock.calls.find(([guarded]) => guarded === wc);
    if (!call) throw new Error('tab not guarded');
    return call[2] as import('../guards').OpenTab;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fakes.views.length = 0;
    guard.mockClear();
    win.contentView.addChildView.mockClear();
    win.contentView.removeChildView.mockClear();
    favicon.fetchFavicon.mockReset();
    favicon.fetchPageIcon.mockReset();
    // The page has no icon of its own to give unless a test says so: the proxy's way is next.
    favicon.fetchPageIcon.mockResolvedValue(null);
    hooks = {
      onCreated: vi.fn<TabsOptions['onCreated']>(),
      onActivated: vi.fn<TabsOptions['onActivated']>(),
      onActiveChanged: vi.fn<TabsOptions['onActiveChanged']>(),
      onStrip: vi.fn<TabsOptions['onStrip']>(),
      onPageIcon: vi.fn<TabsOptions['onPageIcon']>(),
      onEmpty: vi.fn<TabsOptions['onEmpty']>(),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with one tab, attached and guarded, loading nothing yet', () => {
    const tabs = make();
    const first = contentsOf(tabs.active());
    expect(tabs.first.webContents).toBe(first);
    expect(win.contentView.addChildView).toHaveBeenCalledWith(tabs.first, 0);
    expect(guard).toHaveBeenCalledWith(first, log, expect.any(Function));
    expect(hooks.onCreated).toHaveBeenCalledWith(first);
    expect(hooks.onActivated).not.toHaveBeenCalled();
    expect(first.loadURL).not.toHaveBeenCalled();
    expect(tabs.state()).toEqual({
      tabs: [
        {
          id: first.id,
          title: '',
          url: '',
          favicon: null,
          isLoading: false,
          ready: false,
          adopted: false,
        },
      ],
      activeId: first.id,
    });
  });

  it('opens a blank tab in front, under the toolbar, and swaps the views', () => {
    const tabs = make();
    const first = tabs.first;
    const wc = contentsOf(tabs.open(null));
    expect(loaded(wc)).toEqual(['about:blank']);
    expect(tabs.active()).toBe(wc);
    expect(hooks.onActivated).toHaveBeenCalledWith(wc);
    // Blank when the shell asks, so it can hand the keyboard to the address bar.
    expect(tabs.current()?.url).toBe('about:blank');
    expect(win.contentView.addChildView).toHaveBeenLastCalledWith(fakes.views.at(-1)?.view, 0);
    expect(win.contentView.removeChildView).toHaveBeenCalledWith(first);
    expect(lastStrip().activeId).toBe(wc.id);
    expect(lastStrip().tabs.map((t) => t.title)).toEqual(['', '']);
  });

  it('opens a background tab without switching to it', () => {
    const tabs = make();
    const first = tabs.active();
    const wc = contentsOf(tabs.open('https://example.com/', { background: true }));
    expect(tabs.active()).toBe(first);
    expect(hooks.onActivated).not.toHaveBeenCalled();
    expect(lastStrip().tabs.map((t) => t.url)).toEqual(['', 'https://example.com/']);
    // Until its page commits, the strip names it by where it is headed.
    expect(lastStrip().tabs[1]?.title).toBe('https://example.com/');
    expect(loaded(wc)).toEqual(['https://example.com/']);
  });

  it('activates only its own tabs', () => {
    const tabs = make();
    const other = make();
    expect(tabs.activate(contentsOf(other.active()).id)).toBe(false);
    expect(tabs.close(contentsOf(other.active()).id)).toBe(false);
    expect(tabs.close(123456)).toBe(false);
  });

  it('on closing the active tab, activates the next one — or the one before at the end', () => {
    const tabs = make();
    const a = contentsOf(tabs.active());
    const b = contentsOf(tabs.open('https://b.example/', { background: true }));
    const c = contentsOf(tabs.open('https://c.example/', { background: true }));
    expect(tabs.close(a.id)).toBe(true);
    expect(a.close).toHaveBeenCalled();
    expect(tabs.active()).toBe(b);
    tabs.activate(c.id);
    tabs.close(c.id);
    expect(tabs.active()).toBe(b);
    expect(lastStrip().tabs.map((t) => t.id)).toEqual([b.id]);
    expect(hooks.onEmpty).not.toHaveBeenCalled();
  });

  it('closes the window with its last tab', () => {
    const tabs = make();
    tabs.close(contentsOf(tabs.active()).id);
    expect(hooks.onEmpty).toHaveBeenCalledTimes(1);
    expect(tabs.active()).toBeNull();
  });

  it('drops a tab its page closed (window.close())', () => {
    const tabs = make();
    const b = contentsOf(tabs.open('https://b.example/'));
    b.close();
    expect(tabs.state().tabs).toHaveLength(1);
    expect(tabs.active()).toBe(tabs.first.webContents);
    expect(hooks.onActivated).toHaveBeenLastCalledWith(tabs.first.webContents);
  });

  it('cycles round the ends', () => {
    const tabs = make();
    const a = tabs.active();
    const b = tabs.open('https://b.example/', { background: true });
    tabs.cycle(1);
    expect(tabs.active()).toBe(b);
    tabs.cycle(1);
    expect(tabs.active()).toBe(a);
    tabs.cycle(-1);
    expect(tabs.active()).toBe(b);
  });

  it('brings closed tabs back, last first, where they were', () => {
    const tabs = make();
    const b = contentsOf(tabs.open('https://b.example/', { background: true }));
    tabs.open('https://c.example/', { background: true });
    b.url = 'https://b.example/page';
    b.emit('did-navigate');
    tabs.close(b.id);
    const blank = contentsOf(tabs.open(null));
    tabs.close(blank.id);

    expect(tabs.reopenClosed()).toBe(true);
    const back = contentsOf(tabs.active());
    expect(loaded(back)).toEqual(['https://b.example/page']);
    expect(
      lastStrip()
        .tabs.map((t) => t.id)
        .indexOf(back.id),
    ).toBe(1);
    // The blank tab was nothing to bring back.
    expect(tabs.reopenClosed()).toBe(false);
  });

  it('takes a page’s new tab in around the WebContents Electron made, next to its opener', () => {
    const tabs = make();
    const a = tabs.active() as WebContents;
    const z = contentsOf(tabs.open('https://z.example/', { background: true }));
    const guest = new fakes.FakeContents();
    const returned = openTabOf(a)(guest as unknown as WebContents, {
      url: 'https://example.com/item',
      background: true,
      opener: a,
    });
    expect(returned).toBe(guest);
    expect(fakes.views.at(-1)?.adopted).toBe(true);
    expect(guest.loadURL).not.toHaveBeenCalled();
    expect(tabs.active()).toBe(a);
    // After the opener, before the tab that was there already.
    expect(lastStrip().tabs.map((t) => t.id)).toEqual([contentsOf(a).id, guest.id, z.id]);
    // A second link of the same page lines up after the first.
    const guest2 = new fakes.FakeContents();
    openTabOf(a)(guest2 as unknown as WebContents, {
      url: 'https://example.com/item2',
      background: false,
      opener: a,
    });
    expect(tabs.active()).toBe(guest2);
    expect(tabs.state().tabs.map((t) => t.id)).toEqual([
      contentsOf(a).id,
      guest.id,
      guest2.id,
      z.id,
    ]);
    // In front, it is no new tab: the shell gives it the keyboard, not the address bar.
    expect(tabs.activeIsNew()).toBe(false);
    guest2.url = 'https://example.com/item2';
    guest2.emit('did-navigate');
    expect(tabs.current()?.url).toBe('https://example.com/item2');
  });

  describe('the address of a tab with nothing committed yet', () => {
    const start = (wc: Contents, url: string, initiator: unknown = null) =>
      wc.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false, initiator });

    it('is not taken from a page: a link’s tab shows nothing over the blank page its opener can write into', () => {
      const tabs = make();
      const a = tabs.active() as WebContents;
      const guest = new fakes.FakeContents();
      openTabOf(a)(guest as unknown as WebContents, {
        url: 'https://login.example/',
        background: false,
        opener: a,
      });
      expect(tabs.current()?.url).toBe('');
      // The opener's navigation of it (or a later one) has an initiator: still nothing.
      start(guest, 'https://login.example/', { frame: 'opener' });
      expect(tabs.current()?.url).toBe('');
      start(guest, 'https://login.example:8443/', { frame: 'opener' });
      expect(lastStrip().tabs.at(-1)?.url).toBe('');
    });

    it('is shown for main’s own loads, history and reload — and dropped for a page’s navigation that replaces one', () => {
      const tabs = make();
      const wc = contentsOf(tabs.open('https://typed.example/'));
      expect(tabs.current()?.url).toBe('https://typed.example/');
      // Browser-initiated (no initiator): what the user asked for.
      start(wc, 'https://typed.example/');
      expect(tabs.current()?.url).toBe('https://typed.example/');
      start(wc, 'https://elsewhere.example/', { frame: 'page' });
      expect(tabs.current()?.url).toBe('');
      // Never over a page that is there.
      wc.url = 'https://typed.example/';
      wc.emit('did-navigate');
      start(wc, 'https://next.example/');
      expect(tabs.current()?.url).toBe('https://typed.example/');
    });
  });

  it('loads the URL itself, with referrer and POST body, when Electron made no WebContents', () => {
    const tabs = make();
    const a = tabs.active() as WebContents;
    const referrer = { url: 'https://example.com/list', policy: 'default' } as const;
    const wc = contentsOf(
      openTabOf(a)(undefined, {
        url: 'https://example.com/',
        background: false,
        opener: a,
        referrer,
      }),
    );
    expect(wc.loadURL).toHaveBeenCalledWith('https://example.com/', { httpReferrer: referrer });
    expect(tabs.active()).toBe(wc);

    const data = [{ type: 'rawData' as const, bytes: Buffer.from('a=1') }];
    const posted = contentsOf(
      openTabOf(a)(undefined, {
        url: 'https://example.com/search',
        background: true,
        opener: a,
        referrer,
        postBody: { data, contentType: 'multipart/form-data', boundary: 'XyZ' },
      }),
    );
    expect(posted.loadURL).toHaveBeenCalledWith('https://example.com/search', {
      httpReferrer: referrer,
      postData: data,
      extraHeaders: 'content-type: multipart/form-data; boundary=XyZ',
    });
  });

  it('coalesces a burst of page events into one strip update', () => {
    const tabs = make();
    const wc = contentsOf(tabs.active());
    hooks.onStrip.mockClear();
    wc.loading = true;
    wc.emit('did-start-loading');
    wc.title = 'Example';
    wc.emit('page-title-updated');
    wc.loading = false;
    wc.emit('did-stop-loading');
    expect(hooks.onStrip).not.toHaveBeenCalled();
    expect(hooks.onActiveChanged).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60);
    expect(hooks.onStrip).toHaveBeenCalledTimes(1);
  });

  describe('favicons', () => {
    const ICON = 'data:image/png;base64,AAAA';
    const OTHER = 'data:image/png;base64,BBBB';

    /** A page load: committed, its favicon candidates in, loading over. */
    const loadPage = (wc: Contents, url: string, candidates = [`${url}favicon.ico`]) => {
      wc.url = url;
      wc.loading = true;
      wc.emit('did-start-loading');
      wc.emit('did-navigate');
      wc.emit('page-favicon-updated', {}, candidates);
      wc.loading = false;
      wc.emit('did-stop-loading');
    };

    it('asks the page for its own icon first, in a world of its own, and takes it from there', async () => {
      favicon.fetchPageIcon.mockResolvedValue(ICON);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://example.com/', ['https://example.com/icon.svg']);
      expect(favicon.fetchPageIcon).toHaveBeenCalledWith(
        expect.any(Function),
        'https://example.com/',
        ['https://example.com/icon.svg'],
        expect.any(AbortSignal),
      );
      await vi.advanceTimersByTimeAsync(60);
      expect(favicon.fetchFavicon).not.toHaveBeenCalled();
      expect(lastStrip().tabs[0]?.favicon).toBe(ICON);
      expect(tabs.activeFavicon()).toBe(ICON);

      // What the page runs runs in an isolated world: never the page's own (0) nor Electron's (999).
      const run = favicon.fetchPageIcon.mock.calls[0]?.[0];
      await run?.('/* the fetch */');
      const [world, scripts] =
        wc.executeJavaScriptInIsolatedWorld.mock.calls.find(
          ([, code]) => code[0]?.code === '/* the fetch */',
        ) ?? [];
      expect(scripts).toEqual([{ code: '/* the fetch */' }]);
      expect(world).toEqual(expect.any(Number));
      expect([0, 999]).not.toContain(world);
    });

    it('falls back to fetching through the window’s proxy and shows the icon on the strip', async () => {
      favicon.fetchFavicon.mockResolvedValue(ICON);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://example.com/', ['https://example.com/icon.svg']);
      expect(favicon.rankFaviconUrls).toHaveBeenCalledWith(['https://example.com/icon.svg']);
      await vi.advanceTimersByTimeAsync(0);
      expect(favicon.fetchFavicon).toHaveBeenCalledWith(
        'https://example.com/',
        ['https://example.com/icon.svg'],
        PROXY,
        expect.any(AbortSignal),
      );
      await vi.advanceTimersByTimeAsync(60);
      expect(lastStrip().tabs[0]?.favicon).toBe(ICON);
      expect(tabs.activeFavicon()).toBe(ICON);
    });

    it('fetches nothing for a page off the web', () => {
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html');
      expect(favicon.fetchPageIcon).not.toHaveBeenCalled();
      expect(favicon.fetchFavicon).not.toHaveBeenCalled();
    });

    it('drops an icon that comes in after the tab moved on to another page', async () => {
      let resolve: (icon: string) => void = () => undefined;
      favicon.fetchFavicon.mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      );
      favicon.fetchFavicon.mockResolvedValue(null);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://a.example/');
      // The page had none: off through the proxy, which answers only once the tab is on another site.
      await vi.advanceTimersByTimeAsync(0);
      loadPage(wc, 'https://b.example/');
      resolve(ICON);
      await vi.advanceTimersByTimeAsync(2000);
      expect(tabs.activeFavicon()).toBeNull();
      expect(hooks.onPageIcon).not.toHaveBeenCalled();
    });

    it('keeps the icon inside a site, and drops it on another site', async () => {
      favicon.fetchFavicon.mockResolvedValueOnce(ICON).mockResolvedValue(null);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://a.example/');
      await vi.advanceTimersByTimeAsync(10);
      loadPage(wc, 'https://a.example/next');
      await vi.advanceTimersByTimeAsync(10);
      expect(tabs.activeFavicon()).toBe(ICON);
      loadPage(wc, 'https://b.example/');
      await vi.advanceTimersByTimeAsync(10);
      expect(tabs.activeFavicon()).toBeNull();
    });

    it('hands a settled page’s icon to the bookmarks once per page per load', async () => {
      favicon.fetchFavicon.mockResolvedValueOnce(ICON).mockResolvedValueOnce(OTHER);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://example.com/');
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledTimes(1);
      expect(hooks.onPageIcon).toHaveBeenCalledWith(['https://example.com/'], ICON);

      // The page swaps its icon (an unread badge): the strip follows, the bookmarks do not.
      wc.emit('page-favicon-updated', {}, ['https://example.com/badge.ico']);
      await vi.advanceTimersByTimeAsync(1100);
      expect(tabs.activeFavicon()).toBe(OTHER);
      expect(hooks.onPageIcon).toHaveBeenCalledTimes(1);

      // A hash or query route is the same page to the bookmarks: no second write.
      wc.url = 'https://example.com/?chat=1#@someone';
      wc.emit('did-navigate-in-page', {}, wc.url, true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledTimes(1);

      // A route with a path of its own is a page of its own — with the document’s icon, not the badge.
      wc.url = 'https://example.com/settings';
      wc.emit('did-navigate-in-page', {}, wc.url, true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledTimes(2);
      expect(hooks.onPageIcon).toHaveBeenLastCalledWith(['https://example.com/settings'], ICON);
    });

    it('hands it to the address a redirect started from too', async () => {
      favicon.fetchFavicon.mockResolvedValue(ICON);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      const nav = { isMainFrame: true, isSameDocument: false, initiator: null };
      wc.emit('did-start-navigation', { ...nav, url: 'http://example.com/' });
      wc.emit('did-redirect-navigation', { ...nav, url: 'https://example.com/' });
      wc.emit('did-redirect-navigation', { ...nav, url: 'https://www.example.com/' });
      loadPage(wc, 'https://www.example.com/');
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledWith(
        ['http://example.com/', 'https://example.com/', 'https://www.example.com/'],
        ICON,
      );

      // A chain that does not end where the page committed is some other navigation’s: only the page’s own URL.
      hooks.onPageIcon.mockClear();
      wc.emit('did-start-navigation', { ...nav, url: 'https://dropped.example/' });
      loadPage(wc, 'https://www.example.com/next');
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledWith(['https://www.example.com/next'], ICON);
    });

    it('drops the last site’s icon on a failed load, and gives the failed address none', async () => {
      favicon.fetchFavicon.mockResolvedValueOnce(ICON).mockResolvedValue(null);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://a.example/');
      await vi.advanceTimersByTimeAsync(1100);
      expect(tabs.activeFavicon()).toBe(ICON);
      hooks.onPageIcon.mockClear();

      // The error page commits with the failed URL, and no `did-navigate`.
      wc.url = 'https://b.example/';
      wc.loading = true;
      wc.emit('did-start-loading');
      wc.emit('did-fail-provisional-load', {}, -130, 'ERR_PROXY_CONNECTION_FAILED', wc.url, true);
      wc.loading = false;
      wc.emit('did-stop-loading');
      await vi.advanceTimersByTimeAsync(1100);
      expect(tabs.activeFavicon()).toBeNull();
      expect(lastStrip().tabs[0]?.favicon).toBeNull();
      expect(hooks.onPageIcon).not.toHaveBeenCalled();
    });

    it('keeps the page and its icon when a load is only called off, or a frame’s fails', async () => {
      favicon.fetchFavicon.mockResolvedValueOnce(ICON);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://a.example/');
      await vi.advanceTimersByTimeAsync(10);
      wc.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://b.example/', true);
      wc.emit(
        'did-fail-provisional-load',
        {},
        -105,
        'ERR_NAME_NOT_RESOLVED',
        'https://ads.test/',
        false,
      );
      expect(tabs.activeFavicon()).toBe(ICON);
    });

    it('never vouches for another site’s icon, whatever the page events missed', async () => {
      favicon.fetchFavicon.mockResolvedValueOnce(ICON);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://a.example/');
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledWith(['https://a.example/'], ICON);
      // A commit to another site Electron told nothing of.
      wc.url = 'https://b.example/';
      expect(tabs.activeFavicon()).toBeNull();
      wc.emit('did-stop-loading');
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledTimes(1);
    });

    it('fetches one list at a time per tab: a newer one calls the older off, whose answer is dropped', async () => {
      const answers: ((icon: string | null) => void)[] = [];
      const signals: AbortSignal[] = [];
      favicon.fetchFavicon.mockImplementation((_page, _candidates, _proxy, signal) => {
        signals.push(signal as AbortSignal);
        return new Promise<string | null>((resolve) => answers.push(resolve));
      });
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://example.com/', ['https://example.com/slow.png']);
      await vi.advanceTimersByTimeAsync(0);
      wc.emit('page-favicon-updated', {}, ['https://example.com/fast.png']);
      await vi.advanceTimersByTimeAsync(0);
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
      answers[1]?.(OTHER);
      await vi.advanceTimersByTimeAsync(10);
      // The slow, older one lands last: too late.
      answers[0]?.(ICON);
      await vi.advanceTimersByTimeAsync(1100);
      expect(tabs.activeFavicon()).toBe(OTHER);
      expect(hooks.onPageIcon).toHaveBeenCalledWith(['https://example.com/'], OTHER);
    });

    it('lets the same list again ride on the fetch under way', async () => {
      favicon.fetchFavicon.mockImplementation(() => new Promise<string | null>(() => undefined));
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://example.com/', ['https://example.com/a.png']);
      await vi.advanceTimersByTimeAsync(0);
      wc.emit('page-favicon-updated', {}, ['https://example.com/a.png']);
      await vi.advanceTimersByTimeAsync(0);
      expect(favicon.fetchPageIcon).toHaveBeenCalledTimes(1);
      expect(favicon.fetchFavicon).toHaveBeenCalledTimes(1);
      expect(tabs.state().tabs).toHaveLength(1);
    });

    it('calls a tab’s fetch off when it closes, or moves to another page', async () => {
      const signals: AbortSignal[] = [];
      favicon.fetchFavicon.mockImplementation((_page, _candidates, _proxy, signal) => {
        signals.push(signal as AbortSignal);
        return new Promise<string | null>(() => undefined);
      });
      const tabs = make();
      const a = contentsOf(tabs.active());
      const b = contentsOf(tabs.open('https://b.example/', { background: true }));
      loadPage(a, 'https://a.example/');
      await vi.advanceTimersByTimeAsync(0);
      loadPage(a, 'https://a.example/next');
      await vi.advanceTimersByTimeAsync(0);
      expect(signals[0]?.aborted).toBe(true);
      loadPage(b, 'https://b.example/');
      await vi.advanceTimersByTimeAsync(0);
      tabs.close(b.id);
      expect(signals[2]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
      tabs.dispose();
      expect(signals[1]?.aborted).toBe(true);
    });

    it('calls the page’s own fetch off with the tab’s, and goes no further', async () => {
      const signals: AbortSignal[] = [];
      favicon.fetchPageIcon.mockImplementation((_run, _page, _ranked, signal) => {
        signals.push(signal);
        return new Promise<string | null>((resolve) =>
          signal.addEventListener('abort', () => resolve(null)),
        );
      });
      const tabs = make();
      const wc = contentsOf(tabs.active());
      loadPage(wc, 'https://a.example/');
      loadPage(wc, 'https://b.example/');
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      // The one called off does not go on through the proxy.
      expect(favicon.fetchFavicon).not.toHaveBeenCalled();
    });

    it('waits for the page to stop loading', async () => {
      favicon.fetchFavicon.mockResolvedValue(ICON);
      const tabs = make();
      const wc = contentsOf(tabs.active());
      wc.url = 'https://example.com/';
      wc.loading = true;
      wc.emit('did-navigate');
      wc.emit('page-favicon-updated', {}, ['https://example.com/favicon.ico']);
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).not.toHaveBeenCalled();
      wc.loading = false;
      wc.emit('did-stop-loading');
      await vi.advanceTimersByTimeAsync(1100);
      expect(hooks.onPageIcon).toHaveBeenCalledWith(['https://example.com/'], ICON);
    });
  });

  describe('ready, and the cover over the site area', () => {
    const nav = { isMainFrame: true, isSameDocument: false, initiator: null };

    it('makes every view dark underneath — its own tabs and those it takes in', () => {
      const tabs = make();
      tabs.open(null);
      openTabOf(tabs.active() as WebContents)(new fakes.FakeContents() as unknown as WebContents, {
        url: 'https://example.com/',
        background: true,
        opener: tabs.active() as WebContents,
      });
      expect(fakes.views).toHaveLength(3);
      for (const { view } of fakes.views) expect(view.background).toBe(MAIN_COLORS.bg);
    });

    it('gives a page that paints no background of its own Chromium’s white, and keeps the dark under one that does', async () => {
      const tabs = make();
      const wc = contentsOf(tabs.active());
      const view = fakes.views.find((v) => v.view.webContents === wc)?.view;
      wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(false);
      wc.url = 'https://plain.example/';
      wc.emit('did-navigate');
      wc.emit('dom-ready');
      await vi.advanceTimersByTimeAsync(0);
      expect(view?.background).toBe('#ffffff');
      wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(true);
      wc.url = 'https://dark.example/';
      wc.emit('did-navigate');
      wc.emit('dom-ready');
      await vi.advanceTimersByTimeAsync(0);
      expect(view?.background).toBe(MAIN_COLORS.bg);
    });

    it('covers a new tab with its page, and never calls a blank page ready', () => {
      const tabs = make();
      const wc = contentsOf(tabs.open(null));
      expect(tabs.covered()).toBe(true);
      wc.url = 'about:blank';
      wc.emit('did-navigate');
      wc.emit('dom-ready');
      wc.emit('did-stop-loading');
      expect(tabs.current()).toMatchObject({ url: 'about:blank', ready: false });
      expect(tabs.covered()).toBe(true);
    });

    it('covers a first page on its way, and comes down the moment its DOM is ready', () => {
      const tabs = make();
      const wc = contentsOf(tabs.open('https://example.com/'));
      expect(tabs.current()).toMatchObject({ url: 'https://example.com/', ready: false });
      expect(tabs.covered()).toBe(true);
      wc.loading = true;
      wc.emit('did-start-loading');
      wc.url = 'https://example.com/';
      wc.emit('did-navigate');
      // Committed, not yet painted: still covered.
      expect(tabs.covered()).toBe(true);
      hooks.onStrip.mockClear();
      hooks.onActiveChanged.mockClear();
      wc.emit('dom-ready');
      expect(tabs.covered()).toBe(false);
      expect(hooks.onActiveChanged).toHaveBeenCalledTimes(1);
      // The strip hears of it at once, not after the burst.
      expect(lastStrip().tabs.at(-1)).toMatchObject({ id: wc.id, ready: true });
    });

    it('comes down when a load fails, over Chromium’s error page', () => {
      const tabs = make();
      const wc = contentsOf(tabs.open('https://unreachable.example/'));
      wc.loading = true;
      wc.emit('did-start-loading');
      wc.url = 'https://unreachable.example/';
      wc.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', wc.url, true);
      expect(tabs.covered()).toBe(true);
      wc.loading = false;
      wc.emit('did-stop-loading');
      expect(tabs.current()?.ready).toBe(true);
      expect(tabs.covered()).toBe(false);
    });

    it('gives a new tab its page back when a load in it stops with nothing committed', () => {
      const tabs = make();
      const wc = contentsOf(tabs.open(null));
      wc.url = 'about:blank';
      wc.emit('did-stop-loading');
      tabs.load('https://download.example/file.zip');
      wc.emit('did-start-navigation', { ...nav, url: 'https://download.example/file.zip' });
      expect(tabs.current()).toMatchObject({
        url: 'https://download.example/file.zip',
        ready: false,
      });
      expect(tabs.covered()).toBe(true);
      // A download, say: the blank page stays.
      wc.emit('did-stop-loading');
      expect(tabs.current()).toMatchObject({ url: 'about:blank', ready: false });
      expect(tabs.activeIsNew()).toBe(true);
      expect(tabs.covered()).toBe(true);
    });

    it('stays ready for the life of the tab: a later load keeps the page that is there', () => {
      const tabs = make();
      const wc = contentsOf(tabs.open('https://a.example/'));
      wc.url = 'https://a.example/';
      wc.emit('did-navigate');
      wc.emit('dom-ready');
      wc.emit('did-start-navigation', { ...nav, url: 'https://b.example/' });
      wc.loading = true;
      wc.emit('did-start-loading');
      expect(tabs.current()?.ready).toBe(true);
      expect(tabs.covered()).toBe(false);
    });

    it('leaves a link’s blank tab uncovered, and covers it once its page commits until that is ready', () => {
      const tabs = make();
      const a = tabs.active() as WebContents;
      const guest = new fakes.FakeContents();
      openTabOf(a)(guest as unknown as WebContents, {
        url: 'https://example.com/item',
        background: false,
        opener: a,
      });
      expect(tabs.active()).toBe(guest);
      expect(tabs.covered()).toBe(false);
      // The strip says so too: the toolbar draws no cover main does not lay out.
      expect(tabs.current()).toMatchObject({ url: '', ready: false, adopted: true });
      guest.url = 'https://example.com/item';
      guest.emit('did-navigate');
      expect(tabs.covered()).toBe(true);
      guest.emit('dom-ready');
      expect(tabs.covered()).toBe(false);
    });

    it('readies a background tab quietly, and covers none of it while another is in front', async () => {
      const tabs = make();
      const first = contentsOf(tabs.active());
      first.url = 'https://a.example/';
      first.emit('did-navigate');
      first.emit('dom-ready');
      expect(tabs.covered()).toBe(false);
      const b = contentsOf(tabs.open('https://b.example/', { background: true }));
      hooks.onActiveChanged.mockClear();
      hooks.onStrip.mockClear();
      b.url = 'https://b.example/';
      b.emit('did-navigate');
      b.emit('dom-ready');
      expect(hooks.onActiveChanged).not.toHaveBeenCalled();
      expect(hooks.onStrip).not.toHaveBeenCalled();
      expect(tabs.covered()).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      expect(lastStrip().tabs[1]).toMatchObject({ id: b.id, ready: true });
      // In front, it is a page, not a placeholder.
      tabs.activate(b.id);
      expect(tabs.covered()).toBe(false);
    });
  });

  it('closes every tab on dispose, quietly', async () => {
    const tabs = make();
    const a = contentsOf(tabs.active());
    const b = contentsOf(tabs.open('https://b.example/', { background: true }));
    // Electron's own: it closes the popups a tab opened along with the tab.
    const popupCloser = vi.fn();
    a.on('current-render-view-deleted', popupCloser);
    hooks.onStrip.mockClear();
    tabs.dispose();
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
    expect(hooks.onEmpty).not.toHaveBeenCalled();
    expect(hooks.onStrip).not.toHaveBeenCalled();
    expect(tabs.active()).toBeNull();
    expect(a.listenerCount('current-render-view-deleted')).toBe(1);

    // What a closing page still says is heard by no one: no strip, no fetch, no bookmark.
    a.url = 'https://late.example/';
    a.emit('did-navigate');
    a.emit('page-favicon-updated', {}, ['https://late.example/favicon.ico']);
    a.emit('did-stop-loading');
    await vi.advanceTimersByTimeAsync(2000);
    expect(favicon.fetchFavicon).not.toHaveBeenCalled();
    expect(hooks.onStrip).not.toHaveBeenCalled();
    expect(hooks.onActiveChanged).not.toHaveBeenCalled();
    expect(hooks.onPageIcon).not.toHaveBeenCalled();
  });
});
