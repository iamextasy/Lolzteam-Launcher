import type { AdapterLogger } from '@adapter-contract';
import type { BrowserTab, BrowserTabsState, ProxyEntry } from '@shared-types';
import {
  type BrowserWindow,
  type LoadURLOptions,
  type Rectangle,
  type WebContents,
  WebContentsView,
} from 'electron';
import { pageKey } from './bookmarks';
import { type RunInPage, fetchFavicon, fetchPageIcon, rankFaviconUrls } from './favicons';
import { type OpenTab, guardWebContents, isNavigableUrl, isWebUrl } from './guards';
import { ERR_ABORTED, followPageBackground, isBlankUrl } from './page-background';

/**
 * The tabs of one account window. Every tab is a `WebContentsView` in the window's own session, under the site
 * guards; only the active one is attached to the window — the rest load and run detached, as Chrome's background
 * tabs do — and it sits below the toolbar view, whose menus cover the page. Every view is dark underneath until its
 * page has a say (`followPageBackground`): a blank page, or one on its way, is never a white flash.
 */

/** How many closed tabs Ctrl+Shift+T can bring back, per window. */
export const CLOSED_TABS_MAX = 10;
/** A page load is a dozen title / loading / favicon events in a row: the strip is redrawn once per burst. */
const STRIP_PUSH_MS = 50;
/** A page's favicon goes to the bookmarks this long after the page stopped loading, with the icon it settled on. */
const PAGE_ICON_SETTLE_MS = 1000;
/** The isolated world a page fetches its own favicon in: any id but 0 (the page), 999 (Electron's) and the shell's probe. */
const ICON_WORLD = 1208;

export interface ClosedTab {
  readonly url: string;
  /** Where it was on the strip: it comes back there. */
  readonly index: number;
}

/**
 * Whether the toolbar covers the site area: over a new tab (its new-tab page), and over a tab whose first page is on
 * its way and not yet `ready` (a loading placeholder). A blank tab a page's link opened (`adopted`) is no new tab, and
 * stays uncovered — its opener may write into it — until the page it is headed for commits.
 */
export const isCovered = (tab: Pick<BrowserTab, 'url' | 'ready' | 'adopted'>): boolean =>
  isBlankUrl(tab.url) ? !tab.adopted : !tab.ready;

/** The stack with `tab` on top, `CLOSED_TABS_MAX` deep; a blank tab is nothing to bring back. */
export const pushClosedTab = (stack: readonly ClosedTab[], tab: ClosedTab): readonly ClosedTab[] =>
  isBlankUrl(tab.url) ? stack : [...stack, tab].slice(-CLOSED_TABS_MAX);

/** `step` tabs on from `index`, round the ends: the tab after the last one is the first. */
export const cycleIndex = (length: number, index: number, step: number): number =>
  (((index + step) % length) + length) % length;

/**
 * Where the tab a link opened goes: right after its opener and the tabs that opener opened before it, so links
 * Ctrl-clicked one after another line up in the order they were clicked — Chrome's rule.
 */
export const linkTabIndex = (
  openers: readonly (number | null)[],
  openerIndex: number,
  openerId: number,
): number => {
  let at = openerIndex + 1;
  while (at < openers.length && openers[at] === openerId) at += 1;
  return at;
};

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

interface Tab {
  readonly view: WebContentsView;
  readonly wc: WebContents;
  readonly id: number;
  /** The tab whose link opened this one; forgotten when that tab closes. */
  openerId: number | null;
  /**
   * A tab Chromium made for a page's link and navigates itself: blank until its page commits, but no new tab — its
   * page, not the address bar, takes the keyboard.
   */
  readonly adopted: boolean;
  /**
   * Where the tab is headed while it has nothing (or a blank page) committed — only for a load main or the user
   * started, and never shown over a page that is there. A page's own navigation never sets it: the opener of a
   * blank tab can write into it, then send it to an address that never answers, and the bar would vouch for that.
   */
  pending: string;
  /** The main frame's navigation under way: where it started, then each redirect. */
  navChain: string[];
  /** The addresses the current document's load was redirected from: their bookmarks take its icon too. */
  pageFrom: readonly string[];
  /** The page's URL as last seen: a `WebContents` that is gone cannot be asked. */
  lastUrl: string;
  /**
   * The tab has shown a page: its first non-blank document reached `dom-ready`, or its load stopped — a failed one
   * shows Chromium's error page. Never unset: a later load keeps the page that is there until the next one commits.
   */
  ready: boolean;
  /** Bumped by every new document: a favicon fetched for the one before is dropped. */
  page: number;
  /** A `data:` URL, always of the current page's origin. */
  favicon: string | null;
  faviconOrigin: string | null;
  /** The `page` the favicon was fetched for: the one before's (same site) is shown, but not pinned to bookmarks. */
  faviconPage: number;
  /** The favicon fetch under way; a newer list of the page's icons, another page or the tab's end calls it off. */
  iconFetch: AbortController | null;
  /** What that fetch was asked: the page and its icon list. */
  iconAsked: string;
  /**
   * The icon this document gave the bookmarks: its first settled one stands for all its routes — a later swap (an
   * unread badge) is the page's state, not its icon.
   */
  pageIcon: string | null;
  /** The bookmark keys (`pageKey`) this document's icon has gone to: each once per page load. */
  readonly iconSent: Set<string>;
  iconTimer: ReturnType<typeof setTimeout> | null;
}

export interface TabsOptions {
  readonly win: BrowserWindow;
  readonly partition: string;
  readonly log: AdapterLogger;
  /** The window's proxy: favicons go through it too, never from the user's own address. */
  readonly proxy?: ProxyEntry;
  /** Once per tab, before it loads anything: the shell's own listeners (the shortcuts). */
  readonly onCreated: (wc: WebContents) => void;
  /** Another tab became the active one. Not called for the first tab, which is active before anything shows. */
  readonly onActivated: (wc: WebContents) => void;
  /** The active tab's URL, history, loading state, title or `ready` changed. */
  readonly onActiveChanged: () => void;
  /** The strip changed. */
  readonly onStrip: (state: BrowserTabsState) => void;
  /** A page settled with this favicon: the bookmarks pointing at these URLs (the page's, and those it was redirected from) take it. */
  readonly onPageIcon: (urls: readonly string[], icon: string) => void;
  /** The last tab closed. */
  readonly onEmpty: () => void;
}

export interface Tabs {
  /** The tab the window opened with: the adapters' `siteView`. */
  readonly first: WebContentsView;
  /** The active tab's page; `null` once the last tab is gone. */
  readonly active: () => WebContents | null;
  /** The active tab as the strip draws it. */
  readonly current: () => BrowserTab | null;
  /** The active tab is a new tab — blank, with no page's link on its way into it: the address bar takes the keyboard. */
  readonly activeIsNew: () => boolean;
  /** The toolbar covers the active tab's site area (`isCovered`); `onActiveChanged` or `onActivated` says when it may change. */
  readonly covered: () => boolean;
  /** The active tab's favicon (its site's), for a bookmark made of the page. */
  readonly activeFavicon: () => string | null;
  /** Loads `url` into the active tab. */
  readonly load: (url: string) => void;
  /** A new tab at the end of the strip with `url` (`null`: a blank one); active unless `background`. */
  readonly open: (url: string | null, opts?: { readonly background?: boolean }) => WebContents;
  /** For the guards: a tab around the `WebContents` a page's `window.open` made. */
  readonly openFromPage: OpenTab;
  /** `false` when `id` is no tab of this window. */
  readonly close: (id: number) => boolean;
  readonly activate: (id: number) => boolean;
  readonly cycle: (step: 1 | -1) => void;
  /** `false` when there is nothing to bring back. */
  readonly reopenClosed: () => boolean;
  readonly setBounds: (bounds: Rectangle) => void;
  readonly state: () => BrowserTabsState;
  /** Closes every tab, quietly: the window is going. */
  readonly dispose: () => void;
}

export const createTabs = (opts: TabsOptions): Tabs => {
  const { win, log } = opts;
  const list: Tab[] = [];
  let active: Tab | null = null;
  let closed: readonly ClosedTab[] = [];
  let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  let disposed = false;
  let stripTimer: ReturnType<typeof setTimeout> | null = null;

  const newView = (): WebContentsView =>
    new WebContentsView({
      webPreferences: {
        partition: opts.partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

  /** The page's own `fetch`, in a world of its own; what it answers is data. */
  const inPage =
    (tab: Tab): RunInPage =>
    (code) =>
      tab.wc.executeJavaScriptInIsolatedWorld(ICON_WORLD, [{ code }]);

  const live = (tab: Tab | null): tab is Tab => tab !== null && !tab.wc.isDestroyed();
  const byId = (id: number): Tab | undefined =>
    list.find((tab) => tab.id === id && !tab.wc.isDestroyed());

  const urlOf = (tab: Tab): string => {
    const committed = tab.wc.getURL();
    return isBlankUrl(committed) && tab.pending ? tab.pending : committed;
  };

  /** Chromium titles an untitled page with its URL; a blank one gets the strip's «New tab» instead. */
  const describe = (tab: Tab): BrowserTab => {
    const url = urlOf(tab);
    const title = isBlankUrl(url) ? '' : tab.wc.getTitle();
    return {
      id: tab.id,
      title: title && !isBlankUrl(title) ? title : isBlankUrl(url) ? '' : url,
      url,
      favicon: tab.favicon,
      isLoading: tab.wc.isLoading(),
      ready: tab.ready,
      adopted: tab.adopted,
    };
  };

  const state = (): BrowserTabsState => {
    const tabs = list.filter((tab) => !tab.wc.isDestroyed()).map(describe);
    return { tabs, activeId: live(active) ? active.id : (tabs[0]?.id ?? -1) };
  };

  const flushStrip = (): void => {
    if (stripTimer) clearTimeout(stripTimer);
    stripTimer = null;
    if (!disposed) opts.onStrip(state());
  };
  /** `now` for what the user did (a tab opened, closed, switched); the rest waits for its burst to end. */
  const pushStrip = (now = false): void => {
    if (disposed) return;
    if (now) flushStrip();
    else stripTimer ??= setTimeout(flushStrip, STRIP_PUSH_MS);
  };

  const show = (tab: Tab): void => {
    if (tab === active || disposed) return;
    const before = active;
    active = tab;
    if (!win.isDestroyed()) {
      // At the bottom: the toolbar stays on top, so its menus cover the page. In first, out second — no blank frame.
      win.contentView.addChildView(tab.view, 0);
      if (before) win.contentView.removeChildView(before.view);
    }
    pushStrip(true);
    opts.onActivated(tab.wc);
  };

  const clearIconTimer = (tab: Tab): void => {
    if (tab.iconTimer) clearTimeout(tab.iconTimer);
    tab.iconTimer = null;
  };

  const stopIconFetch = (tab: Tab): void => {
    tab.iconFetch?.abort();
    tab.iconFetch = null;
  };

  const dropIcon = (tab: Tab): void => {
    tab.favicon = null;
    tab.faviconOrigin = null;
  };

  /** The favicon, while it is the site's on the page the tab now shows. */
  const siteIcon = (tab: Tab): string | null =>
    tab.faviconOrigin !== null && tab.faviconOrigin === originOf(tab.wc.getURL())
      ? tab.favicon
      : null;

  /**
   * The favicon to the bookmarks once the page has settled — loaded, and no fetch under way — and only the page's
   * own: once per bookmark key per load, to the page's URL and those it was redirected from.
   */
  const settleIcon = (tab: Tab): void => {
    clearIconTimer(tab);
    if (disposed) return;
    tab.iconTimer = setTimeout(() => {
      tab.iconTimer = null;
      if (disposed || !list.includes(tab) || tab.wc.isDestroyed() || tab.wc.isLoading()) return;
      // Its end settles it again.
      if (tab.iconFetch) return;
      const url = tab.wc.getURL();
      // Only ever the site's own icon, onto its own addresses.
      if (!isWebUrl(url) || siteIcon(tab) === null) return;
      const icon = tab.pageIcon ?? (tab.faviconPage === tab.page ? tab.favicon : null);
      if (!icon) return;
      const urls = [...tab.pageFrom, url].filter((u) => {
        const key = pageKey(u);
        if (key === null || tab.iconSent.has(key)) return false;
        tab.iconSent.add(key);
        return true;
      });
      if (urls.length === 0) return;
      tab.pageIcon = icon;
      opts.onPageIcon(urls, icon);
    }, PAGE_ICON_SETTLE_MS);
  };

  /**
   * One fetch per tab at a time, the page's latest list of icons: a newer list calls the older fetch off, so its
   * answer can neither land after the newer one's nor queue up behind the other tabs' fetches. The page fetches its
   * own origin's icons first (`fetchPageIcon`); the rest, and what it could not, go through `fetchFavicon`.
   */
  const fetchIcon = (tab: Tab, candidates: readonly string[]): void => {
    const pageUrl = tab.wc.getURL();
    const ranked = rankFaviconUrls(candidates);
    const asked = [tab.page, pageUrl, ...ranked].join('\n');
    // The same list again — Chromium sends it more than once per load: the fetch under way answers it.
    if (tab.iconFetch && tab.iconAsked === asked) return;
    stopIconFetch(tab);
    if (disposed || !isWebUrl(pageUrl)) return;
    const page = tab.page;
    const run = new AbortController();
    tab.iconFetch = run;
    tab.iconAsked = asked;
    void fetchPageIcon(inPage(tab), pageUrl, ranked, run.signal)
      .then(
        (icon) =>
          icon ??
          (run.signal.aborted ? null : fetchFavicon(pageUrl, ranked, opts.proxy, run.signal)),
      )
      .catch(() => null)
      .then((icon) => {
        // Called off: a newer list, another document, the tab closed or the window went.
        if (tab.iconFetch !== run) return;
        tab.iconFetch = null;
        if (disposed || !list.includes(tab) || tab.page !== page) return;
        if (icon !== null) {
          tab.faviconPage = page;
          if (icon !== tab.favicon) {
            tab.favicon = icon;
            tab.faviconOrigin = originOf(pageUrl);
            pushStrip();
          }
        }
        settleIcon(tab);
      });
  };

  /**
   * A new document, redirected to from `from`: the last one's favicon stays only while it is the same site's — no
   * flicker inside a site.
   */
  const newPage = (tab: Tab, from: readonly string[]): void => {
    tab.page += 1;
    tab.pageFrom = from;
    tab.pageIcon = null;
    tab.iconSent.clear();
    clearIconTimer(tab);
    stopIconFetch(tab);
    tab.lastUrl = tab.wc.getURL();
    if (tab.faviconOrigin !== originOf(tab.lastUrl)) dropIcon(tab);
  };

  /** The tab off the strip — closed by the user or by its page (`window.close()`) — and the next one up. */
  const drop = (tab: Tab): void => {
    const index = list.indexOf(tab);
    if (disposed || index < 0) return;
    list.splice(index, 1);
    clearIconTimer(tab);
    stopIconFetch(tab);
    closed = pushClosedTab(closed, { url: tab.lastUrl, index });
    for (const other of list) if (other.openerId === tab.id) other.openerId = null;
    if (!win.isDestroyed()) win.contentView.removeChildView(tab.view);
    if (tab !== active) {
      pushStrip(true);
      return;
    }
    active = null;
    const next = list[Math.min(index, list.length - 1)];
    if (next) show(next);
    else opts.onEmpty();
  };

  const watch = (tab: Tab): void => {
    const { wc } = tab;
    /** `now`: the strip at once, for the active tab — its cover comes down with it. */
    const changed = (now = false): void => {
      if (disposed) return;
      if (tab === active) opts.onActiveChanged();
      pushStrip(now && tab === active);
    };
    /** Once, on the first page that is not blank. */
    const settleReady = (): boolean => {
      if (tab.ready || isBlankUrl(wc.getURL())) return false;
      tab.ready = true;
      return true;
    };
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      tab.navChain = [details.url];
      // A page's navigation (it has an initiator) shows nothing: see `pending`. Main's loads, history and reload do.
      tab.pending = details.initiator ? '' : details.url;
      if (isBlankUrl(wc.getURL())) changed();
    });
    wc.on('did-redirect-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) tab.navChain.push(details.url);
    });
    wc.on('did-start-loading', () => changed());
    wc.on('did-stop-loading', () => {
      tab.pending = '';
      changed(settleReady());
      settleIcon(tab);
    });
    wc.on('dom-ready', () => {
      if (settleReady()) changed(true);
    });
    wc.on('did-navigate', () => {
      // The chain is this document's only if it ends here: a navigation that started later may have been dropped.
      const chain = tab.navChain;
      tab.navChain = [];
      newPage(tab, chain.at(-1) === wc.getURL() ? chain.slice(0, -1) : []);
      changed();
    });
    // A load that failed commits an error page, with no `did-navigate`: a document all the same, of no site — the
    // last page's icon must neither stay on it nor go to the bookmarks of the address that failed.
    wc.on('did-fail-provisional-load', (_e, code, _description, _url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      tab.navChain = [];
      newPage(tab, []);
      dropIcon(tab);
      changed();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) {
        tab.lastUrl = url;
        // A single-page site's own route is a page of its own to the bookmarks.
        settleIcon(tab);
      }
      changed();
    });
    wc.on('page-title-updated', () => changed());
    wc.on('page-favicon-updated', (_e, candidates) => fetchIcon(tab, candidates));
    wc.once('destroyed', () => drop(tab));
  };

  /** `pending` and `adopted` before anything else: activating the tab reads them (a new tab focuses the address bar). */
  const add = (
    view: WebContentsView,
    at: number,
    how: {
      readonly background: boolean;
      readonly openerId: number | null;
      readonly pending: string;
      readonly adopted?: boolean;
    },
  ): Tab => {
    const wc = view.webContents;
    // Dark under the toolbar's cover and a page on its way; white under a page that leaves its canvas to Chromium.
    followPageBackground(wc, (color) => view.setBackgroundColor(color));
    const tab: Tab = {
      view,
      wc,
      id: wc.id,
      openerId: how.openerId,
      adopted: how.adopted === true,
      pending: how.pending,
      navChain: [],
      pageFrom: [],
      lastUrl: '',
      ready: false,
      page: 0,
      favicon: null,
      faviconOrigin: null,
      faviconPage: -1,
      iconFetch: null,
      iconAsked: '',
      pageIcon: null,
      iconSent: new Set(),
      iconTimer: null,
    };
    list.splice(Math.max(0, Math.min(at, list.length)), 0, tab);
    view.setBounds(bounds);
    guardWebContents(wc, log, openFromPage);
    watch(tab);
    opts.onCreated(wc);
    if (!active) {
      // The first tab: there is nothing to switch from, and nobody to tell yet — the toolbar asks once it loads.
      active = tab;
      if (!win.isDestroyed()) win.contentView.addChildView(view, 0);
    } else if (how.background) {
      pushStrip(true);
    } else {
      show(tab);
    }
    return tab;
  };

  const loadInto = (tab: Tab, url: string, how?: LoadURLOptions): void => {
    tab.pending = url;
    void tab.wc.loadURL(url, how).catch((err: unknown) => {
      log.warn(`[browser-shell] load failed: ${String(err)}`);
    });
  };

  /** A tab of our own making — not one Chromium made and navigates — loading `url`. */
  const openAt = (
    at: number,
    url: string,
    how: {
      readonly background: boolean;
      readonly openerId: number | null;
      readonly load?: LoadURLOptions;
    },
  ): Tab => {
    const tab = add(newView(), at, {
      background: how.background,
      openerId: how.openerId,
      pending: url,
    });
    loadInto(tab, url, how.load);
    return tab;
  };

  const open = (url: string | null, how?: { readonly background?: boolean }): WebContents =>
    openAt(list.length, url ?? 'about:blank', {
      background: how?.background === true,
      openerId: null,
    }).wc;

  /** A tab a page's link opened — Chromium navigates `guest` itself, with the opener and the POST body, if any. */
  const openFromPage: OpenTab = (guest, { url, background, opener, referrer, postBody }) => {
    if (disposed) {
      // The window is going: nothing opens in it any more.
      const orphan = guest ?? newView().webContents;
      setImmediate(() => {
        if (!orphan.isDestroyed()) orphan.close();
      });
      return orphan;
    }
    const from = list.find((tab) => tab.wc === opener);
    const at = from
      ? linkTabIndex(
          list.map((tab) => tab.openerId),
          list.indexOf(from),
          from.id,
        )
      : list.length;
    const openerId = from?.id ?? null;
    if (guest) {
      let view: WebContentsView | null = null;
      try {
        view = new WebContentsView({ webContents: guest });
      } catch (err) {
        log.warn(`[browser-shell] could not take a new tab in: ${String(err)}`);
      }
      if (view) {
        // No `pending`: its opener holds its blank page and can write into it — the bar shows nothing until a commit.
        add(view, at, { background, openerId, pending: '', adopted: true });
        return guest;
      }
      // Not this one: the page opens anyway, without `window.opener`.
      setImmediate(() => {
        if (!guest.isDestroyed()) guest.close();
      });
      openAt(at, url, { background, openerId });
      return guest;
    }
    const load: LoadURLOptions = {
      httpReferrer: referrer,
      ...(postBody && {
        postData: postBody.data,
        extraHeaders: `content-type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ''}`,
      }),
    };
    return openAt(at, url, { background, openerId, load }).wc;
  };

  const close = (id: number): boolean => {
    const tab = byId(id);
    if (!tab) return false;
    tab.lastUrl = tab.wc.getURL() || tab.lastUrl;
    // Off the strip now, not when Chromium gets round to it; no `beforeunload`: a page cannot keep its tab open.
    drop(tab);
    tab.wc.close();
    return true;
  };

  const activate = (id: number): boolean => {
    const tab = byId(id);
    if (!tab) return false;
    show(tab);
    return true;
  };

  const cycle = (step: 1 | -1): void => {
    if (!active || list.length < 2) return;
    const next = list[cycleIndex(list.length, list.indexOf(active), step)];
    if (next) show(next);
  };

  const reopenClosed = (): boolean => {
    while (closed.length > 0) {
      const last = closed[closed.length - 1] as ClosedTab;
      closed = closed.slice(0, -1);
      // An extension page whose extension has been switched off since is not coming back.
      if (!isNavigableUrl(last.url)) continue;
      openAt(last.index, last.url, { background: false, openerId: null });
      return true;
    }
    return false;
  };

  // Nothing loaded: the adapter that opened the window loads its landing page into it.
  const first = add(newView(), 0, { background: false, openerId: null, pending: '' }).view;

  return {
    first,
    active: () => (live(active) ? active.wc : null),
    current: () => (live(active) ? describe(active) : null),
    activeIsNew: () => live(active) && !active.adopted && isBlankUrl(urlOf(active)),
    covered: () => live(active) && isCovered(describe(active)),
    activeFavicon: () => (live(active) ? siteIcon(active) : null),
    load: (url) => {
      if (live(active)) loadInto(active, url);
    },
    open,
    openFromPage,
    close,
    activate,
    cycle,
    reopenClosed,
    setBounds: (next) => {
      bounds = next;
      for (const tab of list) tab.view.setBounds(next);
    },
    state,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (stripTimer) clearTimeout(stripTimer);
      stripTimer = null;
      for (const tab of list.splice(0)) {
        clearIconTimer(tab);
        stopIconFetch(tab);
        // Listeners stay: `disposed` quiets ours, and Electron's own close the popups this tab opened along with it.
        if (!tab.wc.isDestroyed()) tab.wc.close();
      }
      active = null;
    },
  };
};
