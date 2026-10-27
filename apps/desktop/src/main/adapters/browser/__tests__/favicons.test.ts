import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { MAX_BOOKMARK_ICON_CHARS, type ProxyEntry } from '@shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaviconHttp, FaviconHttpRequest, FaviconHttpResponse } from '../favicons';

/** A stand-in for `net`'s request: records what it was asked, answers what the test scripts. */
class FakeRequest extends EventEmitter {
  readonly headers = new Map<string, string>();
  aborted = false;
  constructor(readonly options: Record<string, unknown>) {
    super();
  }
  setHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
  abort() {
    this.aborted = true;
  }
  end() {
    setImmediate(() => script(this));
  }
}

class FakeResponse extends EventEmitter {
  constructor(
    readonly statusCode: number,
    readonly headers: Record<string, string | string[]> = {},
  ) {
    super();
  }
}

let script: (req: FakeRequest) => void = () => undefined;
const requests: FakeRequest[] = [];
const sessions = new Map<string, { partition: string; setProxy: ReturnType<typeof vi.fn> }>();

vi.mock('electron', () => ({
  net: {
    request: vi.fn((options: Record<string, unknown>) => {
      const req = new FakeRequest(options);
      requests.push(req);
      return req;
    }),
  },
  session: {
    fromPartition: vi.fn((partition: string) => {
      let ses = sessions.get(partition);
      if (!ses) {
        ses = { partition, setProxy: vi.fn(async () => undefined) };
        sessions.set(partition, ses);
      }
      return ses;
    }),
  },
}));

const proxyLoginFor = vi.fn((_host: string, _port: number) => null as unknown);
const applyProxyToSession = vi.fn(async (_ses: unknown, _proxy: ProxyEntry) => undefined);
vi.mock('../../../services/proxy', () => ({
  applyProxyToSession: (ses: unknown, proxy: ProxyEntry) => applyProxyToSession(ses, proxy),
  proxyLoginFor: (host: string, port: number) => proxyLoginFor(host, port),
}));

const {
  MAX_ICON_BYTES,
  PAGE_ICON_TIMEOUT_MS,
  createFaviconFetcher,
  faviconPartition,
  fetchFavicon,
  fetchPageIcon,
  iconDataUrl,
  pageIconDataUrl,
  pageIconScript,
  rankFaviconUrls,
  sameOriginIconUrls,
  sniffIcon,
} = await import('../favicons');

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? Array.from(Buffer.from(p, 'utf8')) : p)),
  );

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR');
const ICO = bytes([0, 0, 1, 0, 1, 0], [16, 16, 0, 0]);
const HTML = bytes('<!DOCTYPE html><html><head><title>404 Not Found</title></head></html>');
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>');

const dataUrlOf = (type: string, body: Uint8Array) =>
  `data:${type};base64,${Buffer.from(body).toString('base64')}`;

const PROXY: ProxyEntry = {
  id: 'px-1',
  host: 'proxy.example.test',
  port: 8080,
  username: 'user-1',
  password: 'secret-1',
};

describe('rankFaviconUrls', () => {
  it('keeps the web only', () => {
    expect(
      rankFaviconUrls([
        'data:image/png;base64,iVBORw0KGgo=',
        'blob:https://example.test/0b8f',
        'javascript:alert(1)',
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/icon.png',
        'file:///C:/icon.ico',
        'favicon.ico',
        '',
        'https://example.test/a.png',
      ]),
    ).toEqual(['https://example.test/a.png']);
  });

  it('prefers .svg and .png to .ico, and otherwise keeps the page’s order', () => {
    expect(
      rankFaviconUrls([
        'https://example.test/favicon.ico',
        'https://example.test/icon?size=32',
        'https://example.test/icon-32.PNG',
        'https://example.test/logo.svg',
      ]),
    ).toEqual([
      'https://example.test/icon-32.PNG',
      'https://example.test/logo.svg',
      'https://example.test/icon?size=32',
      'https://example.test/favicon.ico',
    ]);
  });

  it('drops duplicates, the fragment aside, and URLs with credentials', () => {
    expect(
      rankFaviconUrls([
        'https://example.test/a.png',
        'https://EXAMPLE.test/a.png#x',
        'https://user:pass@example.test/b.png',
      ]),
    ).toEqual(['https://example.test/a.png']);
  });

  it('caps the list at four', () => {
    const urls = Array.from({ length: 7 }, (_, i) => `https://example.test/${i}.png`);
    expect(rankFaviconUrls(urls)).toEqual(urls.slice(0, 4));
  });
});

describe('sniffIcon', () => {
  it('knows the image formats by their magic', () => {
    expect(sniffIcon(PNG)).toBe('image/png');
    expect(sniffIcon(ICO)).toBe('image/x-icon');
    expect(sniffIcon(bytes([0, 0, 2, 0, 1, 0]))).toBe('image/x-icon');
    expect(sniffIcon(bytes('GIF89a', [1, 0, 1, 0]))).toBe('image/gif');
    expect(sniffIcon(bytes('GIF87a'))).toBe('image/gif');
    expect(sniffIcon(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffIcon(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
    expect(sniffIcon(bytes('BM', new Array(24).fill(0)))).toBe('image/bmp');
  });

  it('refuses an error page, whatever its Content-Type said', () => {
    expect(sniffIcon(HTML)).toBeNull();
    expect(sniffIcon(bytes('{"error":"not found"}'))).toBeNull();
    expect(sniffIcon(bytes('Not Found'))).toBeNull();
    expect(sniffIcon(new Uint8Array(0))).toBeNull();
    // An ICO header that holds no image, a bitmap too short to have a header.
    expect(sniffIcon(bytes([0, 0, 1, 0, 0, 0]))).toBeNull();
    expect(sniffIcon(bytes('BM'))).toBeNull();
  });

  it('takes an SVG past its BOM, prolog, comments and doctype', () => {
    expect(sniffIcon(SVG)).toBe('image/svg+xml');
    const dressed = bytes(
      [0xef, 0xbb, 0xbf],
      '\n <?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Example 1.0 -->\n',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n',
      '<svg\n  width="16"/>',
    );
    expect(sniffIcon(dressed)).toBe('image/svg+xml');
  });

  it('refuses what only looks like an SVG', () => {
    expect(sniffIcon(bytes('<html><body><svg></svg></body></html>'))).toBeNull();
    expect(sniffIcon(bytes('<svgfont/>'))).toBeNull();
    expect(sniffIcon(bytes('<!-- unterminated <svg/>'))).toBeNull();
    expect(sniffIcon(bytes('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>'))).toBeNull();
    expect(sniffIcon(bytes('text before <svg/>'))).toBeNull();
  });
});

describe('iconDataUrl', () => {
  it('types the data URL by the sniffed format', () => {
    expect(iconDataUrl(PNG)).toBe(dataUrlOf('image/png', PNG));
    expect(iconDataUrl(SVG)).toBe(dataUrlOf('image/svg+xml', SVG));
    expect(iconDataUrl(HTML)).toBeNull();
  });

  it('fits the settings at the biggest size it takes, and refuses one byte more', () => {
    const svgAtLimit = new Uint8Array(MAX_ICON_BYTES).fill(0x20);
    svgAtLimit.set(SVG);
    const url = iconDataUrl(svgAtLimit);
    expect(url?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(url?.length).toBeLessThanOrEqual(MAX_BOOKMARK_ICON_CHARS);

    const over = new Uint8Array(MAX_ICON_BYTES + 1);
    over.set(PNG);
    expect(iconDataUrl(over)).toBeNull();
  });
});

/** A transport the test answers by URL; every call is recorded. */
const fakeHttp = (
  answer: (req: FaviconHttpRequest) => FaviconHttpResponse | Promise<FaviconHttpResponse>,
) => vi.fn<FaviconHttp>(async (req) => answer(req));

const ok = (body: Uint8Array): FaviconHttpResponse => ({ status: 200, body });
const status = (code: number, location?: string): FaviconHttpResponse => ({
  status: code,
  body: new Uint8Array(0),
  ...(location === undefined ? {} : { location }),
});

describe('the page’s own fetch of its icon', () => {
  const base64 = (body: Uint8Array) => Buffer.from(body).toString('base64');

  describe('sameOriginIconUrls', () => {
    it('keeps the page’s own origin’s candidates, best first, and its /favicon.ico last', () => {
      expect(
        sameOriginIconUrls('https://example.test/inbox?x=1', [
          'https://example.test/a.png',
          'https://example.test/e.ico',
        ]),
      ).toEqual([
        'https://example.test/a.png',
        'https://example.test/e.ico',
        'https://example.test/favicon.ico',
      ]);
    });

    it('leaves out another origin’s icons, and the /favicon.ico guess while the page names one there', () => {
      // The icon it names elsewhere comes before the guess, as in Chrome: through `fetchFavicon`.
      expect(
        sameOriginIconUrls('https://example.test/inbox?x=1', [
          'https://example.test/a.png',
          'https://cdn.example.test/b.png',
          'http://example.test/c.png',
          'https://example.test:8443/d.png',
          'https://example.test/e.ico',
        ]),
      ).toEqual(['https://example.test/a.png', 'https://example.test/e.ico']);
      expect(
        sameOriginIconUrls('https://docs.example.test/sheet', [
          'https://static.example.test/sheets-icon.png',
        ]),
      ).toEqual([]);
    });

    it('asks for /favicon.ico once, where the page itself named it', () => {
      expect(
        sameOriginIconUrls('https://example.test/', [
          'https://example.test/favicon.ico',
          'https://example.test/a.svg',
        ]),
      ).toEqual(['https://example.test/favicon.ico', 'https://example.test/a.svg']);
      expect(sameOriginIconUrls('https://example.test/', [])).toEqual([
        'https://example.test/favicon.ico',
      ]);
    });

    it('has nothing for a page off the web', () => {
      expect(
        sameOriginIconUrls('chrome-extension://abcdefghijklmnopabcdefghijklmnop/', []),
      ).toEqual([]);
      expect(sameOriginIconUrls('about:blank', ['https://example.test/a.png'])).toEqual([]);
    });
  });

  describe('pageIconScript, run as the page would', () => {
    type Fetch = (url: string, init: RequestInit) => Promise<Response>;
    /** The script in a realm of its own, with `fetch` the test's: as in the page's isolated world. */
    const runScript = (code: string, fetch: Fetch): Promise<unknown> =>
      runInNewContext(code, {
        fetch,
        AbortController,
        btoa,
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      }) as Promise<unknown>;
    const plain = (answer: unknown) => JSON.parse(JSON.stringify(answer)) as unknown;
    const stream = (...chunks: Uint8Array[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });

    it('fetches the icon as the page, its own origin only, and answers its bytes in base64', async () => {
      const fetch = vi.fn<Fetch>(async () => new Response(PNG));
      const url = 'https://example.test/icon.png?v="2"';
      const answer = await runScript(pageIconScript(url), fetch);
      expect(plain(answer)).toEqual({ ok: true, base64: base64(PNG) });
      expect(pageIconDataUrl(answer)).toBe(dataUrlOf('image/png', PNG));
      const [asked, init] = fetch.mock.calls[0] ?? [];
      expect(asked).toBe(url);
      expect(init).toMatchObject({
        mode: 'same-origin',
        credentials: 'same-origin',
        cache: 'force-cache',
      });
      expect(init?.signal).toBeDefined();
    });

    it('reads an icon up to the limit, and nothing past it', async () => {
      const full = new Uint8Array(MAX_ICON_BYTES).fill(0x41);
      const half = MAX_ICON_BYTES / 3;
      const exact = await runScript(
        pageIconScript('https://example.test/i'),
        async () => new Response(stream(full.subarray(0, half), full.subarray(half))),
      );
      expect((plain(exact) as { base64: string }).base64).toBe(base64(full));

      const over = await runScript(
        pageIconScript('https://example.test/i'),
        async () => new Response(stream(full, new Uint8Array(1))),
      );
      expect(plain(over)).toEqual({ ok: false });

      // Said up front: not read at all.
      const declared = await runScript(
        pageIconScript('https://example.test/i'),
        async () =>
          new Response(PNG, { headers: { 'content-length': String(MAX_ICON_BYTES + 1) } }),
      );
      expect(plain(declared)).toEqual({ ok: false });
    });

    it('answers no for an error page, and for a request that failed', async () => {
      const missing = await runScript(
        pageIconScript('https://example.test/i'),
        async () => new Response(HTML, { status: 404 }),
      );
      expect(plain(missing)).toEqual({ ok: false });
      const refused = await runScript(pageIconScript('https://example.test/i'), async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(plain(refused)).toEqual({ ok: false, timedOut: false });
    });

    describe('with a stalled server', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it(`gives up after ${PAGE_ICON_TIMEOUT_MS / 1000} seconds, and says so`, async () => {
        let signal: AbortSignal | undefined;
        const pending = runScript(
          pageIconScript('https://example.test/i'),
          (_url, init) =>
            new Promise((_resolve, reject) => {
              signal = init.signal ?? undefined;
              signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
        );
        await vi.advanceTimersByTimeAsync(PAGE_ICON_TIMEOUT_MS - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
        expect(plain(await pending)).toEqual({ ok: false, timedOut: true });
      });
    });
  });

  describe('pageIconDataUrl', () => {
    it('takes the bytes for what they are, never the page’s word', () => {
      expect(pageIconDataUrl({ ok: true, base64: base64(ICO) })).toBe(
        dataUrlOf('image/x-icon', ICO),
      );
      expect(pageIconDataUrl({ ok: true, base64: base64(HTML) })).toBeNull();
      expect(pageIconDataUrl({ ok: true, base64: '' })).toBeNull();
    });

    it('refuses any other answer', () => {
      for (const answer of [
        null,
        undefined,
        'iVBORw0KGgo=',
        42,
        { ok: false, base64: base64(PNG) },
        { ok: 'true', base64: base64(PNG) },
        { ok: true, base64: PNG },
        { ok: true, base64: `${base64(PNG)}<script>` },
      ]) {
        expect(pageIconDataUrl(answer), JSON.stringify(answer)).toBeNull();
      }
    });

    it('does not decode an answer longer than any icon', () => {
      const big = new Uint8Array(MAX_ICON_BYTES + 3);
      big.set(PNG);
      expect(pageIconDataUrl({ ok: true, base64: base64(big) })).toBeNull();
    });
  });

  describe('fetchPageIcon', () => {
    /** A page whose answers are scripted by URL; the URL read back out of the script it was given. */
    const page = (answers: Record<string, unknown>) =>
      vi.fn(async (code: string) => {
        const url = JSON.parse(/fetch\(("(?:[^"\\]|\\.)*")/.exec(code)?.[1] ?? '""') as string;
        const answer = answers[url];
        if (answer instanceof Error) throw answer;
        return answer ?? { ok: false };
      });
    const asked = (run: ReturnType<typeof page>) =>
      run.mock.calls.map(([code]) => /fetch\("([^"]*)"/.exec(code)?.[1]);

    it('takes the first of its own origin’s icons that is an image, and never asks for another site’s', async () => {
      const run = page({
        'https://example.test/a.png': { ok: true, base64: base64(HTML) },
        'https://example.test/c.svg': { ok: true, base64: base64(SVG) },
      });
      const icon = await fetchPageIcon(
        run,
        'https://example.test/inbox',
        [
          'https://example.test/a.png',
          'https://cdn.example.test/b.png',
          'https://example.test/c.svg',
        ],
        new AbortController().signal,
      );
      expect(icon).toBe(dataUrlOf('image/svg+xml', SVG));
      expect(asked(run)).toEqual(['https://example.test/a.png', 'https://example.test/c.svg']);
    });

    it('leaves an icon the page names on another origin to fetchFavicon, before any /favicon.ico', async () => {
      // A generic icon at the root, which must not stand in for the one the page names.
      const run = page({
        'https://docs.example.test/favicon.ico': { ok: true, base64: base64(ICO) },
      });
      const icon = await fetchPageIcon(
        run,
        'https://docs.example.test/sheet',
        ['https://static.example.test/sheets-icon.png'],
        new AbortController().signal,
      );
      expect(icon).toBeNull();
      expect(run).not.toHaveBeenCalled();
    });

    it('falls back to the page’s /favicon.ico, and to nothing', async () => {
      const run = page({ 'https://example.test/favicon.ico': { ok: true, base64: base64(ICO) } });
      expect(
        await fetchPageIcon(run, 'https://example.test/', [], new AbortController().signal),
      ).toBe(dataUrlOf('image/x-icon', ICO));
      expect(
        await fetchPageIcon(page({}), 'https://example.test/', [], new AbortController().signal),
      ).toBeNull();
    });

    it('stops asking once a request timed out: the page’s way to its site has stalled', async () => {
      const run = page({ 'https://example.test/a.png': { ok: false, timedOut: true } });
      const icon = await fetchPageIcon(
        run,
        'https://example.test/',
        ['https://example.test/a.png', 'https://example.test/b.png'],
        new AbortController().signal,
      );
      expect(icon).toBeNull();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('asks the next one when a page is gone in the middle of it', async () => {
      const run = page({
        'https://example.test/a.png': new Error('Object has been destroyed'),
        'https://example.test/b.png': { ok: true, base64: base64(PNG) },
      });
      const icon = await fetchPageIcon(
        run,
        'https://example.test/',
        ['https://example.test/a.png', 'https://example.test/b.png'],
        new AbortController().signal,
      );
      expect(icon).toBe(dataUrlOf('image/png', PNG));
    });

    describe('with a page that never answers', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it('waits a moment past the page’s own deadline, and no longer', async () => {
        const run = vi.fn(() => new Promise<unknown>(() => undefined));
        const pending = fetchPageIcon(
          run,
          'https://example.test/',
          ['https://example.test/a.png', 'https://example.test/b.png'],
          new AbortController().signal,
        );
        let done = false;
        void pending.then(() => {
          done = true;
        });
        await vi.advanceTimersByTimeAsync(PAGE_ICON_TIMEOUT_MS);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await pending).toBeNull();
        expect(run).toHaveBeenCalledTimes(1);
      });

      it('stops at once when called off', async () => {
        const run = vi.fn(() => new Promise<unknown>(() => undefined));
        const off = new AbortController();
        const pending = fetchPageIcon(
          run,
          'https://example.test/',
          ['https://example.test/a.png'],
          off.signal,
        );
        await vi.advanceTimersByTimeAsync(10);
        off.abort();
        expect(await pending).toBeNull();
        expect(run).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      });
    });
  });
});

describe('createFaviconFetcher', () => {
  it('answers the first candidate that is an image', async () => {
    const http = fakeHttp(({ url }) =>
      url.endsWith('/broken.png') ? ok(HTML) : url.endsWith('/good.ico') ? ok(ICO) : status(404),
    );
    const { fetchFavicon } = createFaviconFetcher(http);
    const icon = await fetchFavicon(
      'https://example.test/page',
      [
        'https://example.test/missing.svg',
        'https://example.test/broken.png',
        'https://example.test/good.ico',
      ],
      undefined,
    );
    expect(icon).toBe(dataUrlOf('image/x-icon', ICO));
    expect(http.mock.calls.map(([r]) => r.url)).toEqual([
      'https://example.test/missing.svg',
      'https://example.test/broken.png',
      'https://example.test/good.ico',
    ]);
  });

  it('falls back to the origin’s /favicon.ico, once', async () => {
    const http = fakeHttp(({ url }) =>
      url === 'https://example.test/favicon.ico' ? ok(PNG) : status(404),
    );
    const { fetchFavicon } = createFaviconFetcher(http);
    expect(await fetchFavicon('https://example.test/deep/page?q=1', [], undefined)).toBe(
      dataUrlOf('image/png', PNG),
    );

    const miss = fakeHttp(() => status(404));
    const second = createFaviconFetcher(miss);
    expect(
      await second.fetchFavicon(
        'https://example.test/',
        ['https://example.test/favicon.ico'],
        undefined,
      ),
    ).toBeNull();
    expect(miss).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a page that is not on the web', async () => {
    const http = fakeHttp(() => ok(PNG));
    const { fetchFavicon } = createFaviconFetcher(http);
    expect(await fetchFavicon('about:blank', [], undefined)).toBeNull();
    expect(
      await fetchFavicon(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/p.html',
        [],
        undefined,
      ),
    ).toBeNull();
    expect(await fetchFavicon('https://example.test/', ['file:///C:/icon.png'], undefined)).toBe(
      dataUrlOf('image/png', PNG),
    );
    expect(http.mock.calls.map(([r]) => r.url)).toEqual(['https://example.test/favicon.ico']);
  });

  it('follows three redirects, relative ones included, and no more', async () => {
    const chain: Record<string, FaviconHttpResponse> = {
      'https://example.test/a.png': status(301, '/b.png'),
      'https://example.test/b.png': status(302, 'https://cdn.example.test/c.png'),
      'https://cdn.example.test/c.png': status(307, 'd.png'),
      'https://cdn.example.test/d.png': ok(PNG),
    };
    const http = fakeHttp(({ url }) => chain[url] ?? status(404));
    const { fetchFavicon } = createFaviconFetcher(http);
    expect(
      await fetchFavicon('https://other.test/', ['https://example.test/a.png'], undefined),
    ).toBe(dataUrlOf('image/png', PNG));

    const loop = fakeHttp(({ url }) => status(302, `${url}x`));
    const looping = createFaviconFetcher(loop);
    expect(
      await looping.fetchFavicon('https://loop.test/', ['https://loop.test/i.png'], undefined),
    ).toBeNull();
    // Four requests each — three redirects followed — for the candidate and for the fallback.
    expect(loop).toHaveBeenCalledTimes(8);
  });

  it('follows a redirect to the web only', async () => {
    for (const target of [
      'file:///C:/icon.png',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:1',
    ]) {
      const http = fakeHttp(({ url }) =>
        url.endsWith('/i.png') ? status(302, target) : status(404),
      );
      const { fetchFavicon } = createFaviconFetcher(http);
      expect(
        await fetchFavicon('https://example.test/', ['https://example.test/i.png'], undefined),
      ).toBeNull();
      expect(http.mock.calls.map(([r]) => r.url)).toEqual([
        'https://example.test/i.png',
        'https://example.test/favicon.ico',
      ]);
    }
  });

  it('never throws', async () => {
    const http = vi.fn<FaviconHttp>(() => {
      throw new Error('boom');
    });
    const { fetchFavicon } = createFaviconFetcher(http);
    await expect(
      fetchFavicon('https://example.test/', ['https://example.test/a.png'], undefined),
    ).resolves.toBeNull();
    const rejecting = createFaviconFetcher(async () =>
      Promise.reject(new Error('net::ERR_FAILED')),
    );
    await expect(
      rejecting.fetchFavicon('https://example.test/', [], undefined),
    ).resolves.toBeNull();
    // Whatever the caller hands over.
    await expect(
      fetchFavicon(null as unknown as string, [42 as unknown as string], undefined),
    ).resolves.toBeNull();
  });

  it('hands the proxy and the size cap to the transport', async () => {
    const http = fakeHttp(() => ok(PNG));
    const { fetchFavicon } = createFaviconFetcher(http);
    await fetchFavicon('https://example.test/', ['https://example.test/a.png'], PROXY);
    expect(http.mock.calls[0]?.[0]).toMatchObject({ proxy: PROXY, maxBytes: MAX_ICON_BYTES });
  });

  it('tries four candidates at most', async () => {
    const http = fakeHttp(() => status(404));
    const { fetchFavicon } = createFaviconFetcher(http);
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.test/${i}.png`);
    await fetchFavicon('https://example.test/', urls, undefined);
    expect(http.mock.calls.map(([r]) => r.url)).toEqual([
      ...urls.slice(0, 4),
      'https://example.test/favicon.ico',
    ]);
  });

  it('remembers an icon, and a miss for five minutes', async () => {
    let clock = 0;
    let found = false;
    const http = fakeHttp(() => (found ? ok(PNG) : status(404)));
    const { fetchFavicon } = createFaviconFetcher(http, () => clock);
    const ask = () =>
      fetchFavicon('https://example.test/', ['https://example.test/a.png'], undefined);

    expect(await ask()).toBeNull();
    expect(http).toHaveBeenCalledTimes(2);
    found = true;
    clock += 4 * 60_000;
    expect(await ask()).toBeNull();
    expect(http).toHaveBeenCalledTimes(2);

    clock += 2 * 60_000;
    expect(await ask()).toBe(dataUrlOf('image/png', PNG));
    expect(http).toHaveBeenCalledTimes(3);
    expect(await ask()).toBe(dataUrlOf('image/png', PNG));
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('forgets the least recently used past 300 entries', async () => {
    const http = fakeHttp(() => ok(PNG));
    const { fetchFavicon } = createFaviconFetcher(http);
    const icon = (n: number) =>
      fetchFavicon('https://example.test/', [`https://example.test/${n}.png`], undefined);
    for (let n = 0; n < 300; n++) await icon(n);
    await icon(0); // used again: now the newest
    await icon(300); // pushes out 1, the oldest
    http.mockClear();
    await icon(0);
    expect(http).not.toHaveBeenCalled();
    await icon(1);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('asks once for an icon two tabs want at the same time', async () => {
    let answer: (res: FaviconHttpResponse) => void = () => undefined;
    const http = vi.fn<FaviconHttp>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { fetchFavicon } = createFaviconFetcher(http);
    const a = fetchFavicon('https://example.test/1', ['https://example.test/a.png'], undefined);
    const b = fetchFavicon('https://example.test/2', ['https://example.test/a.png'], undefined);
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1));
    answer(ok(PNG));
    expect(await a).toBe(dataUrlOf('image/png', PNG));
    expect(await b).toBe(dataUrlOf('image/png', PNG));
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('runs four fetches at a time', async () => {
    const answers: ((res: FaviconHttpResponse) => void)[] = [];
    const http = vi.fn<FaviconHttp>(() => new Promise((resolve) => answers.push(resolve)));
    const { fetchFavicon } = createFaviconFetcher(http);
    const all = Array.from({ length: 6 }, (_, n) =>
      fetchFavicon(
        `https://site${n}.example.test/`,
        [`https://site${n}.example.test/i.png`],
        undefined,
      ),
    );
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(4));
    await new Promise((r) => setImmediate(r));
    expect(http).toHaveBeenCalledTimes(4);
    answers[0]?.(ok(PNG));
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(5));
    for (let i = 1; i < 6; i++) {
      await vi.waitFor(() => expect(answers[i]).toBeDefined());
      answers[i]?.(ok(PNG));
    }
    expect(await Promise.all(all)).toEqual(new Array(6).fill(dataUrlOf('image/png', PNG)));
  });

  describe('called off', () => {
    /** A transport that answers only when told to, one answer per request. */
    const held = () => {
      const answers: ((res: FaviconHttpResponse) => void)[] = [];
      const signals: AbortSignal[] = [];
      const http = vi.fn<FaviconHttp>(({ signal }) => {
        signals.push(signal);
        return new Promise((resolve) => answers.push(resolve));
      });
      return { http, answers, signals };
    };
    const icon = (n: number) => [`https://site${n}.example.test/i.png`];

    it('asks nothing once its signal has fired', async () => {
      const { http } = held();
      const { fetchFavicon } = createFaviconFetcher(http);
      const off = new AbortController();
      off.abort();
      expect(
        await fetchFavicon('https://example.test/', icon(0), undefined, off.signal),
      ).toBeNull();
      expect(http).not.toHaveBeenCalled();
    });

    it('leaves the line without ever going out, and the slot goes to the next one', async () => {
      const { http, answers } = held();
      const { fetchFavicon } = createFaviconFetcher(http);
      for (let n = 0; n < 4; n++)
        void fetchFavicon(`https://site${n}.example.test/`, icon(n), undefined);
      const off = new AbortController();
      const stale = fetchFavicon('https://site4.example.test/', icon(4), undefined, off.signal);
      const next = fetchFavicon('https://site5.example.test/', icon(5), undefined);
      await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(4));
      off.abort();
      expect(await stale).toBeNull();
      answers[0]?.(ok(PNG));
      await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(5));
      expect(http.mock.calls.map(([r]) => r.url)).not.toContain(icon(4)[0]);
      expect(http.mock.calls.at(-1)?.[0].url).toBe(icon(5)[0]);
      answers[4]?.(ok(PNG));
      expect(await next).toBe(dataUrlOf('image/png', PNG));
    });

    it('stops a request under way only when no one else waits for it, and remembers no miss for it', async () => {
      const { http, answers, signals } = held();
      const { fetchFavicon } = createFaviconFetcher(http);
      const a = new AbortController();
      const b = new AbortController();
      const first = fetchFavicon('https://example.test/1', icon(0), undefined, a.signal);
      const second = fetchFavicon('https://example.test/2', icon(0), undefined, b.signal);
      await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1));
      a.abort();
      expect(await first).toBeNull();
      expect(signals[0]?.aborted).toBe(false);
      b.abort();
      expect(await second).toBeNull();
      expect(signals[0]?.aborted).toBe(true);
      // Late, and for no one: not an answer to keep.
      answers[0]?.(ok(PNG));

      // Asked again, it goes out again.
      const again = fetchFavicon('https://example.test/3', icon(0), undefined);
      await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(2));
      answers[1]?.(ok(PNG));
      expect(await again).toBe(dataUrlOf('image/png', PNG));
    });

    it('answers the one still waiting when another one calls off', async () => {
      const { http, answers } = held();
      const { fetchFavicon } = createFaviconFetcher(http);
      const off = new AbortController();
      const gone = fetchFavicon('https://example.test/1', icon(0), undefined, off.signal);
      const kept = fetchFavicon('https://example.test/2', icon(0), undefined);
      await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1));
      off.abort();
      answers[0]?.(ok(PNG));
      expect(await gone).toBeNull();
      expect(await kept).toBe(dataUrlOf('image/png', PNG));
    });
  });

  describe('with a stalled server', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives up after twenty seconds and aborts the request', async () => {
      const signals: AbortSignal[] = [];
      const http = vi.fn<FaviconHttp>(({ signal }) => {
        signals.push(signal);
        return new Promise(() => undefined);
      });
      const { fetchFavicon } = createFaviconFetcher(http);
      const pending = fetchFavicon('https://slow.test/', ['https://slow.test/i.png'], undefined);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals[0]?.aborted).toBe(true);
      // Then the fallback, with twenty seconds of its own.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toBeNull();
      expect(http).toHaveBeenCalledTimes(2);
    });
  });
});

describe('fetchFavicon through Electron', () => {
  beforeEach(() => {
    requests.length = 0;
    applyProxyToSession.mockReset();
    applyProxyToSession.mockResolvedValue(undefined);
    proxyLoginFor.mockReset();
    proxyLoginFor.mockReturnValue(null);
  });

  const respond =
    (code: number, body: Uint8Array, headers: Record<string, string> = {}) =>
    (req: FakeRequest) => {
      const res = new FakeResponse(code, headers);
      req.emit('response', res);
      setImmediate(() => {
        if (body.length > 0) res.emit('data', Buffer.from(body));
        res.emit('end');
      });
    };

  it('names its sessions by the route alone, never an account’s', () => {
    expect(faviconPartition(undefined)).toBe('favicon-direct');
    expect(faviconPartition(PROXY)).toBe('favicon-px-1-http-proxy.example.test:8080');
    expect(faviconPartition({ ...PROXY, protocol: 'https', port: 443 })).toBe(
      'favicon-px-1-https-proxy.example.test:443',
    );
    for (const p of [undefined, PROXY, { ...PROXY, id: 'persist:lzt-account-1' }]) {
      expect(faviconPartition(p).startsWith('favicon-')).toBe(true);
    }
  });

  it('fetches through an in-memory session with no cookies, sent direct without a proxy', async () => {
    script = respond(200, PNG, { 'content-type': 'text/html' });
    expect(
      await fetchFavicon('https://direct.test/', ['https://direct.test/a.png'], undefined),
    ).toBe(dataUrlOf('image/png', PNG));
    const ses = sessions.get('favicon-direct');
    expect(ses?.setProxy).toHaveBeenCalledWith({ mode: 'direct' });
    expect(requests[0]?.options).toMatchObject({
      session: ses,
      url: 'https://direct.test/a.png',
      useSessionCookies: false,
      redirect: 'manual',
    });
    expect(applyProxyToSession).not.toHaveBeenCalled();
    const { session } = await import('electron');
    for (const [partition] of vi.mocked(session.fromPartition).mock.calls) {
      expect(partition.startsWith('persist:')).toBe(false);
    }
  });

  it('goes through the window’s proxy, set up once per route, and answers its login only', async () => {
    proxyLoginFor.mockReturnValue({ username: 'user-1', password: 'secret-1' });
    const answers: unknown[][] = [];
    script = (req) => {
      req.emit(
        'login',
        { isProxy: true, host: PROXY.host, port: PROXY.port },
        (...args: unknown[]) => answers.push(args),
      );
      req.emit('login', { isProxy: false, host: 'site.test', port: 443 }, (...args: unknown[]) =>
        answers.push(args),
      );
      respond(200, ICO)(req);
    };
    expect(await fetchFavicon('https://proxied.test/', ['https://proxied.test/a.ico'], PROXY)).toBe(
      dataUrlOf('image/x-icon', ICO),
    );
    await fetchFavicon('https://proxied.test/', ['https://proxied.test/b.ico'], PROXY);

    const ses = sessions.get(faviconPartition(PROXY));
    expect(applyProxyToSession).toHaveBeenCalledTimes(1);
    expect(applyProxyToSession).toHaveBeenCalledWith(ses, PROXY);
    expect(requests[0]?.options.session).toBe(ses);
    expect(proxyLoginFor).toHaveBeenCalledWith(PROXY.host, PROXY.port);
    expect(answers[0]).toEqual(['user-1', 'secret-1']);
    expect(answers[1]).toEqual([]);
  });

  it('falls back to the entry’s own login when the proxy map has none', async () => {
    const answers: unknown[][] = [];
    script = (req) => {
      req.emit(
        'login',
        { isProxy: true, host: PROXY.host, port: PROXY.port },
        (...args: unknown[]) => answers.push(args),
      );
      respond(200, PNG)(req);
    };
    await fetchFavicon('https://own-login.test/', ['https://own-login.test/a.png'], {
      ...PROXY,
      id: 'px-2',
    });
    expect(answers[0]).toEqual(['user-1', 'secret-1']);
  });

  it('sends nothing when the proxy cannot be set', async () => {
    applyProxyToSession.mockRejectedValue(new Error('bad proxy'));
    const broken = { ...PROXY, id: 'px-broken' };
    expect(
      await fetchFavicon('https://leak.test/', ['https://leak.test/a.png'], broken),
    ).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('hands a redirect back instead of following it', async () => {
    script = (req) => {
      if (req.options.url === 'https://moved.test/a.png') {
        req.emit('redirect', 301, 'GET', 'https://moved.test/b.png', {});
      } else respond(200, PNG)(req);
    };
    expect(await fetchFavicon('https://moved.test/', ['https://moved.test/a.png'], undefined)).toBe(
      dataUrlOf('image/png', PNG),
    );
    expect(requests.map((r) => r.options.url)).toEqual([
      'https://moved.test/a.png',
      'https://moved.test/b.png',
    ]);
    expect(requests[0]?.aborted).toBe(true);
  });

  it('stops reading a body past the cap', async () => {
    script = (req) => {
      const res = new FakeResponse(200);
      req.emit('response', res);
      setImmediate(() => {
        res.emit('data', Buffer.from(PNG));
        res.emit('data', Buffer.alloc(MAX_ICON_BYTES));
        res.emit('end');
      });
    };
    expect(
      await fetchFavicon('https://huge.test/', ['https://huge.test/a.png'], undefined),
    ).toBeNull();
    expect(requests[0]?.aborted).toBe(true);

    requests.length = 0;
    script = (req) =>
      req.emit('response', new FakeResponse(200, { 'content-length': `${MAX_ICON_BYTES + 1}` }));
    expect(
      await fetchFavicon('https://huge2.test/', ['https://huge2.test/a.png'], undefined),
    ).toBeNull();
    expect(requests[0]?.aborted).toBe(true);
  });

  it('reads an error status as no icon', async () => {
    script = respond(404, HTML);
    expect(
      await fetchFavicon('https://gone.test/', ['https://gone.test/a.png'], undefined),
    ).toBeNull();
    script = (req) => req.emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
    expect(await fetchFavicon('https://down.test/', [], undefined)).toBeNull();
  });
});
