import { MAX_BOOKMARK_ICON_CHARS, type ProxyEntry } from '@shared-types';
import { net, type Session, session } from 'electron';
import { applyProxyToSession, proxyLoginFor } from '../../services/proxy';

/**
 * Site favicons as `data:` URLs, for the tab strip and the bookmarks bar: the toolbar's CSP admits no remote image.
 *
 * A page's own icon is fetched by the page first (`fetchPageIcon`), over the connection it loaded through. Otherwise
 * from main, and never through the account's own session — on Electron 33 a main-process request through a session
 * with a webRequest-listening extension in it (SIH) crashes the app. Instead an in-memory session per proxy route
 * that never carries a cookie or an extension, and goes out through the window's own proxy: the site must not see
 * the user's real address next to the proxied one.
 */

/** Per icon URL: a proxy can take this long to open a fresh connection to a site it is slow to reach. */
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const MAX_CANDIDATES = 4;
const MAX_CONCURRENT = 4;
const CACHE_SIZE = 300;
/** A miss is asked again soon: the site may have been down, or the proxy. */
const MISS_TTL_MS = 5 * 60_000;
const HIT_TTL_MS = 60 * 60_000;
const URL_MAX = 4096;

const ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

type IconType =
  | 'image/png'
  | 'image/x-icon'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/bmp'
  | 'image/svg+xml';

/** The longest type's prefix: every icon of this many raw bytes still fits the settings as base64. */
const LONGEST_PREFIX = 'data:image/svg+xml;base64,'.length;
export const MAX_ICON_BYTES = Math.floor((MAX_BOOKMARK_ICON_CHARS - LONGEST_PREFIX) / 4) * 3;

const startsWith = (bytes: Uint8Array, at: number, signature: readonly number[]): boolean =>
  bytes.length >= at + signature.length && signature.every((b, i) => bytes[at + i] === b);

const ascii = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));

/**
 * Whether the text is an SVG document: past a BOM, whitespace, the XML prolog, processing instructions, comments
 * and a doctype, the first element is `<svg`. A doctype with an internal subset (entity tricks) is not an icon.
 */
const isSvg = (bytes: Uint8Array): boolean => {
  let rest = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end < 0) return false;
      rest = rest.slice(end + 2);
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end < 0) return false;
      rest = rest.slice(end + 3);
    } else if (/^<!DOCTYPE\s/i.test(rest)) {
      const end = rest.indexOf('>');
      if (end < 0 || rest.slice(0, end).includes('[')) return false;
      rest = rest.slice(end + 1);
    } else {
      return /^<svg[\s/>]/.test(rest);
    }
  }
};

/** What the bytes are, by their magic — never by `Content-Type`, which an error page answers with as readily. */
export const sniffIcon = (bytes: Uint8Array): IconType | null => {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // ICO and CUR: a reserved zero, the type (1 or 2), and at least one image.
  if (
    (startsWith(bytes, 0, [0, 0, 1, 0]) || startsWith(bytes, 0, [0, 0, 2, 0])) &&
    bytes.length >= 6 &&
    ((bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8)) > 0
  ) {
    return 'image/x-icon';
  }
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a')))
    return 'image/gif';
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP')))
    return 'image/webp';
  // The file header and the smallest DIB header.
  if (startsWith(bytes, 0, ascii('BM')) && bytes.length >= 26) return 'image/bmp';
  return isSvg(bytes) ? 'image/svg+xml' : null;
};

/** The icon as the toolbar and the settings take it; `null` when it is no image, or too big for the settings. */
export const iconDataUrl = (bytes: Uint8Array): string | null => {
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
  const type = sniffIcon(bytes);
  if (!type) return null;
  const url = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
  return url.length <= MAX_BOOKMARK_ICON_CHARS ? url : null;
};

/** An absolute `http:`/`https:` URL without credentials or fragment, in the browser's spelling; `null` otherwise. */
const webHref = (raw: unknown, base?: string): URL | null => {
  if (typeof raw !== 'string' || raw === '' || raw.length > URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // `user:pass@` would be sent as credentials; nothing a page names as its icon needs them.
  if (url.username || url.password) return null;
  // Never sent to the server, so `icon.png#a` and `icon.png#b` are one icon.
  url.hash = '';
  return url.href.length <= URL_MAX ? url : null;
};

const preference = (url: URL): number => {
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.svg') || path.endsWith('.png')) return 0;
  return path.endsWith('.ico') ? 2 : 1;
};

/** Pick and order `page-favicon-updated` URLs: http(s) only, de-duplicated, prefer .svg/.png over .ico, cap 4. */
export const rankFaviconUrls = (urls: readonly string[]): string[] => {
  const seen = new Set<string>();
  const ranked: { href: string; rank: number }[] = [];
  for (const raw of urls) {
    const url = webHref(raw);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    ranked.push({ href: url.href, rank: preference(url) });
  }
  // `sort` is stable: within a rank, the page's own order.
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.href);
};

/** The page's own request for its icon gives up after this: its way to its own site has stalled. */
export const PAGE_ICON_TIMEOUT_MS = 10_000;
/** Main waits a little past the page's own deadline: a page that went away, or is held by a dialog, never answers. */
const PAGE_ICON_GRACE_MS = 1_000;
/** The base64 of the biggest icon there is; an answer longer than this is not read. */
const MAX_ICON_BASE64 = Math.ceil(MAX_ICON_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * What the page may fetch its icon from itself: those of the candidates (`rankFaviconUrls`' list) of its own origin,
 * best first, then its `/favicon.ico` — where `fetchFavicon` falls back to as well. Not that guess while the page
 * names an icon on another origin: the icon it names comes first, as in Chrome, and that one is `fetchFavicon`'s.
 */
export const sameOriginIconUrls = (pageUrl: string, ranked: readonly string[]): string[] => {
  const page = webHref(pageUrl);
  if (!page) return [];
  const own: string[] = [];
  let elsewhere = false;
  for (const raw of ranked) {
    const url = webHref(raw);
    if (!url) continue;
    if (url.origin !== page.origin) elsewhere = true;
    else if (!own.includes(url.href)) own.push(url.href);
  }
  const fallback = new URL('/favicon.ico', page.origin).href;
  return elsewhere || own.includes(fallback) ? own : [...own, fallback];
};

/**
 * The page's fetch of `url` (one of `sameOriginIconUrls`), run in an isolated world of it: the page's origin,
 * cookies, cache and warm connection, none of its scripts. `same-origin` mode fails a redirect to another site; the
 * body is read no further than `MAX_ICON_BYTES`, and the whole of it given up after `PAGE_ICON_TIMEOUT_MS`.
 * Answers `{ ok: true, base64 }` or `{ ok: false, timedOut }` — an answer main takes for no more than data.
 */
export const pageIconScript = (url: string): string => `(async () => {
  const max = ${MAX_ICON_BYTES};
  const stop = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, ${PAGE_ICON_TIMEOUT_MS});
  try {
    const res = await fetch(${JSON.stringify(url)}, {
      mode: 'same-origin',
      credentials: 'same-origin',
      cache: 'force-cache',
      signal: stop.signal,
    });
    if (!res.ok || !res.body || Number(res.headers.get('content-length')) > max) return { ok: false };
    const reader = res.body.getReader();
    const bytes = new Uint8Array(max);
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > max) return { ok: false };
      bytes.set(value, size);
      size += value.length;
    }
    let binary = '';
    for (let at = 0; at < size; at += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(at, Math.min(size, at + 0x8000)));
    }
    return { ok: true, base64: btoa(binary) };
  } catch {
    return { ok: false, timedOut };
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
})()`;

/** The page's answer as an icon — judged as anything off the network is, by its bytes; `null` for anything else. */
export const pageIconDataUrl = (answer: unknown): string | null => {
  if (typeof answer !== 'object' || answer === null) return null;
  const { ok, base64 } = answer as { readonly ok?: unknown; readonly base64?: unknown };
  if (ok !== true || typeof base64 !== 'string') return null;
  if (base64.length > MAX_ICON_BASE64 || !BASE64.test(base64)) return null;
  return iconDataUrl(Buffer.from(base64, 'base64'));
};

/** Runs a script in the page's isolated world and hands back what it answered: `executeJavaScriptInIsolatedWorld`. */
export type RunInPage = (code: string) => Promise<unknown>;

const STALLED = Symbol('stalled');

/** The page's answer; `STALLED` past the deadline, `null` if it failed or `signal` called it off. */
const askPage = (run: RunInPage, code: string, signal: AbortSignal): Promise<unknown> =>
  new Promise((resolve) => {
    const settle = (value: unknown): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', off);
      resolve(value);
    };
    const off = (): void => settle(null);
    const timer = setTimeout(() => settle(STALLED), PAGE_ICON_TIMEOUT_MS + PAGE_ICON_GRACE_MS);
    signal.addEventListener('abort', off, { once: true });
    // A page that is gone throws rather than rejects.
    Promise.resolve()
      .then(() => run(code))
      .then(settle, () => settle(null));
  });

/**
 * The page's icon, fetched by the page itself: through the connection it loaded over — behind a slow proxy a fresh
 * one from another session can take longer than any timeout. Its own origin's icons only (`sameOriginIconUrls`), the
 * first that is an image winning; a request that timed out ends the tries, the page's way to its site being stalled.
 * `null` for none, or once `signal` calls it off: `fetchFavicon` is the way left.
 */
export const fetchPageIcon = async (
  run: RunInPage,
  pageUrl: string,
  ranked: readonly string[],
  signal: AbortSignal,
): Promise<string | null> => {
  for (const url of sameOriginIconUrls(pageUrl, ranked)) {
    if (signal.aborted) return null;
    const answer = await askPage(run, pageIconScript(url), signal);
    if (signal.aborted || answer === STALLED) return null;
    const icon = pageIconDataUrl(answer);
    if (icon) return icon;
    if ((answer as { readonly timedOut?: unknown } | null)?.timedOut === true) return null;
  }
  return null;
};

/** One request, one hop: a redirect comes back as such, to be checked before it is followed. */
export interface FaviconHttpRequest {
  readonly url: string;
  readonly proxy: ProxyEntry | undefined;
  /** A body past this is refused (rejected) instead of read. */
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

export interface FaviconHttpResponse {
  readonly status: number;
  /** A redirect's target, absolute or relative to the request. */
  readonly location?: string;
  readonly body: Uint8Array;
}

export type FaviconHttp = (request: FaviconHttpRequest) => Promise<FaviconHttpResponse>;

export interface FaviconFetcher {
  readonly fetchFavicon: (
    pageUrl: string,
    candidates: readonly string[],
    proxy: ProxyEntry | undefined,
    signal?: AbortSignal,
  ) => Promise<string | null>;
}

/** A request for one icon URL, shared by every tab that wants it; called off once none of them does. */
interface Flight {
  readonly result: Promise<string | null | undefined>;
  readonly cancel: AbortController;
  waiters: number;
}

/** The fetching and caching around a transport — Electron's in the app, a fake in the tests. */
export const createFaviconFetcher = (
  http: FaviconHttp,
  now: () => number = Date.now,
): FaviconFetcher => {
  /** Icon URL → its icon or a miss; a `Map` iterates oldest first, so it is its own LRU. */
  const cache = new Map<string, { readonly icon: string | null; readonly expires: number }>();
  /** Two tabs of one site load together: one request between them. */
  const flights = new Map<string, Flight>();

  let active = 0;
  const waiting: (() => void)[] = [];
  /**
   * A slot, or `false` once `cancel` fires: a fetch nobody wants any more leaves the line instead of going out later
   * — a page swapping its icon to one dead host after another would otherwise grow the line for every window.
   */
  const acquire = (cancel: AbortSignal): Promise<boolean> => {
    if (cancel.aborted) return Promise.resolve(false);
    if (active < MAX_CONCURRENT) {
      active++;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const leave = (): void => {
        const at = waiting.indexOf(take);
        if (at >= 0) waiting.splice(at, 1);
        resolve(false);
      };
      const take = (): void => {
        cancel.removeEventListener('abort', leave);
        resolve(true);
      };
      waiting.push(take);
      cancel.addEventListener('abort', leave, { once: true });
    });
  };
  /** Hands the slot straight to the next in line, so `active` never overshoots. */
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  const recall = (url: string): { readonly icon: string | null } | undefined => {
    const hit = cache.get(url);
    if (!hit) return undefined;
    cache.delete(url);
    if (hit.expires <= now()) return undefined;
    cache.set(url, hit);
    return hit;
  };

  const remember = (url: string, icon: string | null): void => {
    cache.delete(url);
    cache.set(url, { icon, expires: now() + (icon ? HIT_TTL_MS : MISS_TTL_MS) });
    for (const oldest of cache.keys()) {
      if (cache.size <= CACHE_SIZE) break;
      cache.delete(oldest);
    }
  };

  /** Follows up to `MAX_REDIRECTS` redirects, each one to the web only. */
  const follow = async (start: string, proxy: ProxyEntry | undefined, signal: AbortSignal) => {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await http({ url, proxy, maxBytes: MAX_ICON_BYTES, signal });
      if (res.status >= 300 && res.status < 400) {
        const next = webHref(res.location, url);
        if (!next) return null;
        url = next.href;
        continue;
      }
      return res.status >= 200 && res.status < 300 ? iconDataUrl(res.body) : null;
    }
    return null;
  };

  /** The icon, `null` for none — or `undefined` when called off, which is no answer and is not remembered. */
  const load = async (
    url: string,
    proxy: ProxyEntry | undefined,
    cancel: AbortSignal,
  ): Promise<string | null | undefined> => {
    if (!(await acquire(cancel))) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const stop = (): void => controller.abort();
    cancel.addEventListener('abort', stop, { once: true });
    // Settles with the deadline even if the transport does not listen for it.
    const deadline = new Promise<null>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(null), { once: true }),
    );
    try {
      const icon = await Promise.race([follow(url, proxy, controller.signal), deadline]);
      return cancel.aborted ? undefined : icon;
    } catch {
      return cancel.aborted ? undefined : null;
    } finally {
      clearTimeout(timer);
      cancel.removeEventListener('abort', stop);
      controller.abort();
      release();
    }
  };

  const flightFor = (url: string, proxy: ProxyEntry | undefined): Flight => {
    const current = flights.get(url);
    if (current) return current;
    const cancel = new AbortController();
    const flight: Flight = {
      cancel,
      waiters: 0,
      result: load(url, proxy, cancel.signal).then((icon) => {
        if (flights.get(url) === flight) flights.delete(url);
        if (icon !== undefined) remember(url, icon);
        return icon;
      }),
    };
    flights.set(url, flight);
    return flight;
  };

  /** One icon URL; a caller whose `signal` fires stops waiting at once, and the request stops with the last one. */
  const iconAt = (
    url: string,
    proxy: ProxyEntry | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string | null> => {
    const hit = recall(url);
    if (hit) return Promise.resolve(hit.icon);
    if (signal?.aborted) return Promise.resolve(null);
    const flight = flightFor(url, proxy);
    flight.waiters++;
    return new Promise((resolve) => {
      let done = false;
      const leave = (): void => {
        if (done) return;
        done = true;
        flight.waiters--;
        if (flight.waiters === 0) {
          // Out of the map first: the next tab to want this icon asks afresh, not a request on its way out.
          if (flights.get(url) === flight) flights.delete(url);
          flight.cancel.abort();
        }
        resolve(null);
      };
      signal?.addEventListener('abort', leave, { once: true });
      void flight.result.then((icon) => {
        if (done) return;
        done = true;
        flight.waiters--;
        signal?.removeEventListener('abort', leave);
        resolve(icon ?? null);
      });
    });
  };

  const fetchFavicon: FaviconFetcher['fetchFavicon'] = async (
    pageUrl,
    candidates,
    proxy,
    signal,
  ) => {
    try {
      const tried = new Set<string>();
      for (const raw of candidates) {
        if (signal?.aborted) return null;
        const url = webHref(raw);
        if (!url || tried.has(url.href)) continue;
        if (tried.size >= MAX_CANDIDATES) break;
        tried.add(url.href);
        const icon = await iconAt(url.href, proxy, signal);
        if (icon) return icon;
      }
      if (signal?.aborted) return null;
      const page = webHref(pageUrl);
      const fallback = page ? new URL('/favicon.ico', page.origin).href : null;
      if (!fallback || tried.has(fallback)) return null;
      return await iconAt(fallback, proxy, signal);
    } catch {
      return null;
    }
  };

  return { fetchFavicon };
};

/**
 * The session a route's favicons go through: in memory (no `persist:`), and named by the proxy alone — so it can
 * never be an account's session, whose extensions would crash a main-process request. A route is the proxy's id
 * and address together: an entry edited to another server gets a session set to the new one.
 */
export const faviconPartition = (proxy: ProxyEntry | undefined): string =>
  proxy
    ? `favicon-${proxy.id}-${proxy.protocol ?? 'http'}-${proxy.host}:${proxy.port}`
    : 'favicon-direct';

const sessions = new Map<string, Promise<Session>>();

const sessionFor = (proxy: ProxyEntry | undefined): Promise<Session> => {
  const partition = faviconPartition(proxy);
  const cached = sessions.get(partition);
  if (cached) return cached;
  const created = (async () => {
    const ses = session.fromPartition(partition, { cache: false });
    // No request leaves before the proxy is set: a failure here fails the fetch, never sends it direct.
    if (proxy) await applyProxyToSession(ses, proxy);
    else await ses.setProxy({ mode: 'direct' });
    return ses;
  })();
  sessions.set(partition, created);
  // Set up again on the next fetch, rather than keep a session whose proxy is unknown.
  created.catch(() => sessions.delete(partition));
  return created;
};

const EMPTY = new Uint8Array(0);

const headerValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Electron's transport: `net` through the route's session, no cookies either way, redirects handed back. */
const electronHttp: FaviconHttp = async ({ url, proxy, maxBytes, signal }) => {
  const ses = await sessionFor(proxy);
  return new Promise<FaviconHttpResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    // `useSessionCookies: false` blocks cookies both ways; the session never holds one anyway.
    const req = net.request({ session: ses, url, useSessionCookies: false, redirect: 'manual' });

    let settled = false;
    const finish = (settle: () => void, abort: boolean): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (abort) {
        try {
          req.abort();
        } catch {
          // already gone
        }
      }
      settle();
    };
    const onAbort = () => finish(() => reject(new Error('aborted')), true);
    signal.addEventListener('abort', onAbort, { once: true });

    req.setHeader('Accept', ACCEPT);

    // The proxy's own login, as the window's session answers it; a site asking for one gets none.
    req.on('login', (authInfo, callback) => {
      const creds =
        authInfo.isProxy && proxy
          ? (proxyLoginFor(authInfo.host, authInfo.port) ??
            (proxy.username ? { username: proxy.username, password: proxy.password ?? '' } : null))
          : null;
      if (creds) callback(creds.username, creds.password);
      else callback();
    });

    req.on('redirect', (statusCode, _method, redirectUrl) => {
      finish(() => resolve({ status: statusCode, location: redirectUrl, body: EMPTY }), true);
    });

    req.on('response', (response) => {
      const status = response.statusCode;
      if (status < 200 || status >= 300) {
        finish(() => resolve({ status, body: EMPTY }), true);
        return;
      }
      const declared = Number(headerValue(response.headers['content-length']));
      if (declared > maxBytes) {
        finish(() => reject(new Error('too large')), true);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        // Not buffered whole in main: an "icon" that streams on is no icon.
        if (size > maxBytes) {
          finish(() => reject(new Error('too large')), true);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () =>
        finish(() => resolve({ status, body: Buffer.concat(chunks) }), false),
      );
      response.on('error', (err: Error) => finish(() => reject(err), false));
    });

    req.on('error', (err) => finish(() => reject(err), false));
    req.end();
  });
};

const shared = createFaviconFetcher(electronHttp);

/**
 * Fetches the first usable icon among `candidates` (absolute http/https URLs, best first), falling back to
 * `<origin>/favicon.ico` of `pageUrl`; through a per-proxy session that never carries cookies or extensions. Never
 * throws. `signal` calls it off — the tab moved on — with `null`, its requests leaving the line if no one else waits.
 */
export const fetchFavicon: (
  pageUrl: string,
  candidates: readonly string[],
  proxy: ProxyEntry | undefined,
  signal?: AbortSignal,
) => Promise<string | null> = shared.fetchFavicon;
