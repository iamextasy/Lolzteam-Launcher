import { createHash } from 'node:crypto';
import { ExtensionError, fail } from './errors';
import { compareVersions, isValidVersion } from './manifest';

/** A Chrome extension id: 32 letters `a`–`p`. */
export const EXTENSION_ID = /^[a-p]{32}$/;

/** No store package comes near this; a download that does is cut off. */
export const MAX_CRX_BYTES = 256 * 1024 ** 2;

/** The Chromium this Electron is built on; the store picks the package build by it. */
const FALLBACK_PRODVERSION = '130.0.6723.191';

const UPDATE_ENDPOINT = 'https://clients2.google.com/service/update2/crx';

/** The slice of a fetch `Response` this module reads — `net.fetch` gives one, and so does `new Response()` in tests. */
export interface FetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<FetchResponse>;

/** Electron's network stack, so a system proxy is honoured; it follows the redirect to the package blob itself. */
const electronFetch: Fetcher = async (url, init) => {
  const { net } = await import('electron');
  return net.fetch(url, { signal: init.signal, redirect: 'follow' });
};

const prodVersion = (): string => process.versions.chrome ?? FALLBACK_PRODVERSION;

/**
 * The extension id in what the user pasted: a bare id, a `chromewebstore.google.com/detail/<slug>/<id>` link,
 * or an old `chrome.google.com/webstore/detail/<slug>/<id>` one (the slug may be missing). `null` for anything else.
 */
export const parseWebstoreInput = (input: string): string | null => {
  const raw = input.trim();
  if (EXTENSION_ID.test(raw.toLowerCase())) return raw.toLowerCase();

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  let rest: string[];
  if (url.hostname === 'chromewebstore.google.com' && parts[0] === 'detail') {
    rest = parts.slice(1);
  } else if (
    url.hostname === 'chrome.google.com' &&
    parts[0] === 'webstore' &&
    parts[1] === 'detail'
  ) {
    rest = parts.slice(2);
  } else {
    return null;
  }

  // `/detail/<slug>/<id>`, `/detail/<id>`, and whatever tab of the listing follows the id.
  const id = [rest[1], rest[0]].find((p) => p !== undefined && EXTENSION_ID.test(p));
  return id ?? null;
};

/** Answers with a redirect to the newest package. */
export const crxDownloadUrl = (id: string): string =>
  `${UPDATE_ENDPOINT}?response=redirect&prodversion=${prodVersion()}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;

/** Answers with an XML verdict for `version`: what is newer and its SHA-256, or `noupdate`. */
export const updateCheckUrl = (id: string, version: string): string =>
  `${UPDATE_ENDPOINT}?response=updatecheck&prodversion=${prodVersion()}&acceptformat=crx2,crx3&x=id%3D${id}%26v%3D${version}%26uc`;

export type UpdateCheck =
  | { readonly status: 'update'; readonly version: string; readonly sha256: string | null }
  | { readonly status: 'noupdate' }
  | { readonly status: 'not_found' };

const attributes = (tag: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? '');
  }
  return out;
};

/** Reads the store's `gupdate` answer for `id`; `null` when it is not one. */
export const parseUpdateCheck = (xml: string, id: string): UpdateCheck | null => {
  for (const app of xml.matchAll(/<app\b([^>]*?)(?:\/>|>([\s\S]*?)<\/app>)/gi)) {
    const attrs = attributes(app[1] ?? '');
    if (attrs.get('appid') !== id) continue;
    // `error-unknownApplication` and friends: the store has no such extension (any more).
    if (attrs.has('status') && attrs.get('status') !== 'ok') return { status: 'not_found' };
    const check = /<updatecheck\b([^>]*?)\/?>/i.exec(app[2] ?? '');
    if (!check) return null;
    const uc = attributes(check[1] ?? '');
    const status = uc.get('status');
    if (status === 'noupdate') return { status: 'noupdate' };
    if (status !== 'ok') return status?.startsWith('error') ? { status: 'not_found' } : null;
    const version = uc.get('version') ?? '';
    if (!isValidVersion(version)) return null;
    const hash = uc.get('hash_sha256')?.toLowerCase() ?? '';
    return { status: 'update', version, sha256: /^[0-9a-f]{64}$/.test(hash) ? hash : null };
  }
  return null;
};

interface FetchLimits {
  /** Hard ceiling for the whole transfer. */
  readonly totalMs: number;
  /** How long the body may go without a byte. */
  readonly stallMs: number;
  readonly maxBytes: number;
}

/** GETs `url` into memory, cut off at `maxBytes`, and when it stalls or runs too long. */
const fetchBytes = async (
  fetcher: Fetcher,
  url: string,
  limits: FetchLimits,
): Promise<{ status: number; body: Buffer }> => {
  const controller = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), limits.stallMs);
  };
  const total = setTimeout(() => controller.abort(), limits.totalMs);
  try {
    arm();
    const res = await fetcher(url, { signal: controller.signal });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
      fail('too_large', `the download is ${declared} bytes`);
    }
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, body: Buffer.alloc(0) };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxBytes) {
        await reader.cancel().catch(() => undefined);
        fail('too_large', `the download is over ${limits.maxBytes} bytes`);
      }
      chunks.push(value);
    }
    return { status: res.status, body: Buffer.concat(chunks, size) };
  } catch (err) {
    if (err instanceof ExtensionError) throw err;
    if (controller.signal.aborted) fail('download_failed', `timed out fetching ${url}`);
    return fail('download_failed', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(stall);
    clearTimeout(total);
  }
};

/** Asks the store what is newer than `version` (`0.0.0.0` for "anything"). */
export const checkWebstoreUpdate = async (
  id: string,
  version: string,
  fetcher: Fetcher = electronFetch,
): Promise<UpdateCheck> => {
  const res = await fetchBytes(fetcher, updateCheckUrl(id, version), {
    totalMs: 30_000,
    stallMs: 30_000,
    maxBytes: 1024 ** 2,
  });
  if (res.status !== 200) fail('download_failed', `update check answered HTTP ${res.status}`);
  const verdict = parseUpdateCheck(res.body.toString('utf8'), id);
  if (!verdict) fail('download_failed', 'update check answered something unreadable');
  return verdict;
};

export interface CrxDownloadOptions {
  /** The store's `hash_sha256` for the package; checked when there is one. */
  readonly sha256?: string | null;
  readonly fetcher?: Fetcher;
  readonly maxBytes?: number;
}

/** Downloads the newest package of `id` from the store. */
export const downloadWebstoreCrx = async (
  id: string,
  options: CrxDownloadOptions = {},
): Promise<Buffer> => {
  const res = await fetchBytes(options.fetcher ?? electronFetch, crxDownloadUrl(id), {
    totalMs: 30 * 60_000,
    stallMs: 60_000,
    maxBytes: options.maxBytes ?? MAX_CRX_BYTES,
  });
  // The store answers an id it does not know with an empty 204 rather than a 404.
  if (res.status === 204 || res.status === 404)
    fail('not_found', `the store has no extension ${id}`);
  if (res.status !== 200) fail('download_failed', `the store answered HTTP ${res.status}`);
  if (res.body.length === 0) fail('not_found', `the store sent nothing for ${id}`);
  if (options.sha256) {
    const actual = createHash('sha256').update(res.body).digest('hex');
    if (actual !== options.sha256) fail('download_failed', 'the package does not match its hash');
  }
  return res.body;
};

/** Whether the store's `version` is newer than the installed `current`. */
export const isNewer = (version: string, current: string): boolean =>
  compareVersions(version, current) > 0;
