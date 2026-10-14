import type { PageCursor, RawOrdersResponse } from '@market-sdk';
import { readNextPage, readRateLimit } from '@market-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** How far the market walk goes, and what it says when it does not get there. */
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' } }));
vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../auth/token-store', () => ({
  loadToken: async () => 'token',
  onTokenChange: () => undefined,
}));
vi.mock('../api-session', () => ({ appFetch: async () => new Response('') }));

const api = vi.hoisted(() => ({ listOrders: vi.fn(), listUser: vi.fn() }));

// Only the client is replaced; `readRateLimit` is the real one.
vi.mock('@market-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@market-sdk')>();
  return {
    ...actual,
    MarketClient: class {
      listOrders = api.listOrders;
      listUser = api.listUser;
    },
  };
});

const { listAccountsByCategory, listPurchasedAccounts } = await import('../market');

const PER_PAGE = 40;

/** A cursor the way the server mints them: opaque, and not a page number in disguise. */
const token = (n: number): string => Buffer.from(`{"v":1,"k":[${n}]}`).toString('base64url');

/** Which page a request asked for, read back from the cursor it carried. */
const pageOf = (cursor?: PageCursor): number => {
  if (!cursor) return 1;
  if ('page' in cursor) return cursor.page;
  return (JSON.parse(Buffer.from(cursor.after, 'base64url').toString()) as { k: [number] }).k[0];
};

/** One page of a base of `total` accounts, shaped the way the API shapes it. */
const page = (n: number, total: number, extra: Partial<RawOrdersResponse> = {}) => {
  const first = (n - 1) * PER_PAGE;
  const count = Math.max(0, Math.min(PER_PAGE, total - first));
  const more = extra.hasNextPage ?? first + count < total;
  return {
    items: Array.from({ length: count }, (_, i) => ({ item_id: first + i + 1, category_id: 1 })),
    totalItems: total,
    perPage: PER_PAGE,
    hasNextPage: more,
    nextPageHref: more ? `https://lzt.market/user/orders?after=${token(n + 1)}` : null,
    ...extra,
  } as RawOrdersResponse;
};

/** The same page from a server that has not moved to cursors yet. */
const legacyPage = (n: number, total: number) => {
  const { nextPageHref: _, ...rest } = page(n, total);
  return { ...rest, page: n } as RawOrdersResponse;
};

const serve = (total: number, extra: Partial<RawOrdersResponse> = {}): void => {
  api.listOrders.mockImplementation(async ({ cursor }) => page(pageOf(cursor), total, extra));
};

beforeEach(() => {
  api.listOrders.mockReset();
  api.listUser.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('market pagination', () => {
  it('walks a base far past the old 2000-account ceiling', async () => {
    serve(3000);
    const { items, complete } = await listPurchasedAccounts();

    expect(items).toHaveLength(3000);
    expect(complete).toBe(true);
    // 75 pages — the old guard would have let through 50 and said nothing.
    expect(api.listOrders).toHaveBeenCalledTimes(75);
  });

  it('is bounded per category, not across the base', async () => {
    serve(2400);
    const { items, complete } = await listAccountsByCategory(1);

    expect(items).toHaveLength(2400);
    expect(complete).toBe(true);
  });

  it('reports every page to the caller as it arrives', async () => {
    serve(100);
    const seen: number[] = [];
    await listAccountsByCategory(1, 'purchased', (_items, progress) => {
      seen.push(progress.page);
      expect(progress.totalPages).toBe(3);
    });

    expect(seen).toEqual([1, 2, 3]);
  });

  it('stops short of the total it was promised only by the server saying so', async () => {
    // `hasNextPage` is the authority; the derived bound only ever backs it up.
    serve(200, { hasNextPage: false });
    const { items, complete } = await listPurchasedAccounts();

    expect(items).toHaveLength(PER_PAGE);
    expect(complete).toBe(true);
  });

  // The guard has to survive, or a stuck `hasNextPage` becomes an endless loop.
  describe('the runaway guard', () => {
    it('holds when the server never admits the list ended', async () => {
      // No totals to derive a bound from, and `hasNextPage` pinned to `true`.
      api.listOrders.mockResolvedValue({
        items: [],
        totalItems: 0,
        perPage: 0,
        page: 1,
        hasNextPage: true,
        nextPageHref: undefined,
      } as RawOrdersResponse);
      const { complete } = await listPurchasedAccounts();

      expect(complete).toBe(false);
      expect(api.listOrders).toHaveBeenCalledTimes(1000);
    });

    it('allows a few pages past the reported total, for a base that grows', async () => {
      // The server says one page but keeps claiming another.
      serve(PER_PAGE, { hasNextPage: true });
      const { complete } = await listPurchasedAccounts();

      expect(api.listOrders).toHaveBeenCalledTimes(4);
      expect(complete).toBe(false);
    });
  });

  describe('cursors', () => {
    it('starts bare and then passes each `after` through untouched', async () => {
      serve(100);
      await listPurchasedAccounts();

      const cursors = api.listOrders.mock.calls.map(([params]) => params.cursor);
      expect(cursors).toEqual([undefined, { after: token(2) }, { after: token(3) }]);
    });

    it('ends on a null `nextPageHref`, whatever `hasNextPage` says', async () => {
      serve(200, { hasNextPage: true, nextPageHref: null });
      const { items, complete } = await listPurchasedAccounts();

      expect(items).toHaveLength(PER_PAGE);
      expect(complete).toBe(true);
      expect(api.listOrders).toHaveBeenCalledTimes(1);
    });

    it('keeps the category filter on every page', async () => {
      serve(100);
      await listAccountsByCategory(7);

      for (const [params] of api.listOrders.mock.calls) expect(params.categoryId).toBe(7);
    });

    it('stops, short, when the server keeps handing back the same cursor', async () => {
      api.listOrders.mockImplementation(async ({ cursor }) =>
        page(pageOf(cursor), 1000, { nextPageHref: `https://lzt.market/?after=${token(2)}` }),
      );
      const { items, complete } = await listPurchasedAccounts();

      expect(items).toHaveLength(80);
      expect(complete).toBe(false);
      expect(api.listOrders).toHaveBeenCalledTimes(2);
    });

    it('stops, short, when the server ignores the cursor and repeats page one', async () => {
      // What `?page=` turns into after the switch: the parameter is dropped, page one comes back.
      api.listOrders.mockImplementation(async () => legacyPage(1, 1000));
      const { items, complete } = await listPurchasedAccounts();

      expect(items).toHaveLength(PER_PAGE);
      expect(complete).toBe(false);
      expect(api.listOrders).toHaveBeenCalledTimes(2);
    });

    it('still walks a server that only knows numbered pages', async () => {
      api.listOrders.mockImplementation(async ({ cursor }) => legacyPage(pageOf(cursor), 100));
      const { items, complete } = await listPurchasedAccounts();

      expect(items).toHaveLength(100);
      expect(complete).toBe(true);
      const cursors = api.listOrders.mock.calls.map(([params]) => params.cursor);
      expect(cursors).toEqual([undefined, { page: 2 }, { page: 3 }]);
    });
  });

  describe('a walk that could not finish', () => {
    it('keeps the pages that did arrive, and admits it is short', async () => {
      api.listOrders.mockImplementation(async ({ cursor }) => {
        const n = pageOf(cursor);
        if (n === 3) throw new Error('502');
        return page(n, 1000);
      });
      const streamed: number[] = [];
      const { items, complete } = await listAccountsByCategory(1, 'purchased', (batch) => {
        streamed.push(...batch.map((it) => it.itemId));
      });

      // Discarding them would have the renderer contradict what it already drew.
      expect(items).toHaveLength(80);
      expect(streamed).toHaveLength(80);
      expect(complete).toBe(false);
    });

    it('gives back what it has when the caller aborts', async () => {
      const controller = new AbortController();
      api.listOrders.mockImplementation(async ({ cursor }) => {
        const n = pageOf(cursor);
        if (n === 2) controller.abort();
        return page(n, 1000);
      });
      const { items, complete } = await listPurchasedAccounts('purchased', controller.signal);

      expect(items).toHaveLength(80);
      expect(complete).toBe(false);
    });
  });

  describe('pacing', () => {
    it('runs at full speed while the window has budget left', async () => {
      vi.useFakeTimers();
      const reset = Math.floor(Date.now() / 1000) + 30;
      serve(200, { system_info: { rate_limit: { limit: 300, remaining: 250, reset } } });

      // No timer is ever advanced; if the walk waited, this would never settle.
      const { items, complete } = await listPurchasedAccounts();
      expect(items).toHaveLength(200);
      expect(complete).toBe(true);
    });

    it('waits for the window to roll over when the budget is spent', async () => {
      vi.useFakeTimers();
      api.listOrders.mockImplementation(async ({ cursor }) =>
        page(pageOf(cursor), 120, {
          // A live limiter moves the reset forward with every window.
          system_info: {
            rate_limit: { limit: 300, remaining: 0, reset: Math.floor(Date.now() / 1000) + 30 },
          },
        }),
      );

      const walk = listPurchasedAccounts();
      await vi.advanceTimersByTimeAsync(10);
      // Page two is not being requested — it is sitting out the window.
      expect(api.listOrders).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(31_000);
      expect(api.listOrders).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(31_000);
      const { items, complete } = await walk;
      expect(items).toHaveLength(120);
      expect(complete).toBe(true);
    });

    it('does not wait on a window that has already rolled over', async () => {
      vi.useFakeTimers();
      const reset = Math.floor(Date.now() / 1000) - 5;
      serve(200, { system_info: { rate_limit: { limit: 300, remaining: 0, reset } } });

      expect((await listPurchasedAccounts()).items).toHaveLength(200);
    });
  });
});

/** The block is undocumented, so the parser has to treat every field as hostile. */
describe('readRateLimit', () => {
  const wrap = (rate_limit: unknown) => ({ system_info: { rate_limit } });

  it('reads a well-formed block', () => {
    expect(readRateLimit(wrap({ limit: 300, remaining: 12, reset: 1_760_000_000 }))).toEqual({
      limit: 300,
      remaining: 12,
      reset: 1_760_000_000,
    });
  });

  it('keeps a remaining of zero, which is the whole point of reading it', () => {
    expect(readRateLimit(wrap({ limit: 120, remaining: 0, reset: 1 }))?.remaining).toBe(0);
  });

  it('returns null when there is nothing to read', () => {
    expect(readRateLimit(undefined)).toBeNull();
    expect(readRateLimit(null)).toBeNull();
    expect(readRateLimit({})).toBeNull();
    expect(readRateLimit({ system_info: null })).toBeNull();
    expect(readRateLimit(wrap(undefined))).toBeNull();
  });

  it('refuses a half-filled or misshapen block rather than guessing at it', () => {
    expect(readRateLimit(wrap({ limit: 300, remaining: 12 }))).toBeNull();
    expect(readRateLimit(wrap({ limit: 300, remaining: '12', reset: 1 }))).toBeNull();
    expect(readRateLimit(wrap({ limit: 300, remaining: -1, reset: 1 }))).toBeNull();
    expect(readRateLimit(wrap({ limit: 300, remaining: Number.NaN, reset: 1 }))).toBeNull();
    expect(readRateLimit(wrap('nope'))).toBeNull();
  });
});

describe('readNextPage', () => {
  it('takes `after` from the href, as-is', () => {
    const after = 'eyJ2IjoxLCJzIjoiM2Y5YTFjMmUiLCJrIjpbMTc1OTQ4MDAwMCwyMDEyMzQ1NjddfQ';
    expect(
      readNextPage({
        nextPageHref: `https://lzt.market/steam/?order_by=pdate_to_down&after=${after}`,
      }),
    ).toEqual({ after });
  });

  it('reads a relative href too', () => {
    expect(readNextPage({ nextPageHref: '/user/orders?after=abc' })).toEqual({ after: 'abc' });
  });

  it('falls back to a numbered href while the server still sends one', () => {
    expect(readNextPage({ nextPageHref: 'https://lzt.market/steam/?page=3' })).toEqual({ page: 3 });
  });

  it('treats null as the end of the list', () => {
    expect(readNextPage({ nextPageHref: null })).toBeNull();
  });

  it('says nothing when there is nothing it can use', () => {
    expect(readNextPage({})).toBeUndefined();
    expect(readNextPage(null)).toBeUndefined();
    expect(readNextPage({ nextPageHref: 42 })).toBeUndefined();
    expect(readNextPage({ nextPageHref: 'https://lzt.market/steam/' })).toBeUndefined();
    expect(readNextPage({ nextPageHref: 'https://lzt.market/?page=nope' })).toBeUndefined();
  });
});
