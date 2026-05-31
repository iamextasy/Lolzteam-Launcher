import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowDownUp, RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AccountSummary, ServiceId } from '@shared-types';
import { AccountCard } from './AccountCard';
import { SkeletonCard } from './InventorySkeleton';
import s from './InventoryView.module.scss';

const CHUNK = 24;

const SKELETON_INITIAL = 8;
const SKELETON_TAIL = 4;

const SUPPORTED_SERVICES = ['steam', 'telegram', 'tiktok'] as const satisfies readonly ServiceId[];
type SupportedService = (typeof SUPPORTED_SERVICES)[number];
const isSupportedService = (id: ServiceId | null): id is SupportedService =>
  id !== null && (SUPPORTED_SERVICES as readonly string[]).includes(id);

const SERVICE_LABELS: Record<SupportedService, string> = {
  steam: 'Steam',
  telegram: 'Telegram',
  tiktok: 'TikTok',
};

type Filter = ServiceId | 'all';

type SortKey = 'purchased' | 'price' | 'warranty';
type SortDir = 'asc' | 'desc';

const SORT_KEYS: readonly SortKey[] = ['purchased', 'price', 'warranty'] as const;

const searchHaystack = (item: AccountSummary): string => {
  const parts: (string | null | undefined)[] = [
    item.title,
    item.categoryTitle,
    item.steam?.country,
    item.telegram?.country,
    item.telegram?.username,
    item.telegram?.phone,
    ...(item.steam?.games.map((g) => g.title) ?? []),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
};

const matchesQuery = (item: AccountSummary, query: string): boolean => {
  if (!query) return true;
  const haystack = searchHaystack(item);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};

const sortValue = (item: AccountSummary, key: SortKey): number | null => {
  switch (key) {
    case 'purchased':
      return item.purchasedAt;
    case 'price':
      return item.price;
    case 'warranty':
      return item.warrantyEndsAt;
  }
};

const compareItems = (
  a: AccountSummary,
  b: AccountSummary,
  key: SortKey,
  dir: SortDir,
): number => {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return dir === 'asc' ? va - vb : vb - va;
};

interface Bucket {
  id: Filter;
  label: string;
  count: number;
  loading: boolean;
}

const buildBuckets = (
  items: AccountSummary[],
  allLabel: string,
  loaded: ReadonlySet<SupportedService>,
  streaming: boolean,
): Bucket[] => {
  const counts = new Map<SupportedService, number>();
  for (const item of items) {
    if (isSupportedService(item.category)) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const allDone = SUPPORTED_SERVICES.every((id) => loaded.has(id));
  const buckets: Bucket[] = [
    { id: 'all', label: allLabel, count: total, loading: streaming && !allDone },
  ];
  for (const id of SUPPORTED_SERVICES) {
    buckets.push({
      id,
      label: SERVICE_LABELS[id],
      count: counts.get(id) ?? 0,
      loading: !loaded.has(id),
    });
  }
  return buckets;
};

export const InventoryView = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('purchased');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [limit, setLimit] = useState(CHUNK);
  const [streaming, setStreaming] = useState(false);
  const [loaded, setLoaded] = useState<ReadonlySet<SupportedService>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const streamedRef = useRef(new Map<SupportedService, AccountSummary[]>());

  const mergeWithStream = (base: AccountSummary[]): AccountSummary[] => {
    const touched = streamedRef.current;
    const kept = base.filter(
      (it) => !(isSupportedService(it.category) && touched.has(it.category)),
    );
    return [...kept, ...[...touched.values()].flat()];
  };

  const query = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => mergeWithStream(await window.launcher.accounts.list()),
    staleTime: 60_000,
  });

  const rebuildFromStream = () => {
    qc.setQueryData<AccountSummary[]>(['accounts'], (prev) =>
      mergeWithStream(prev ?? []),
    );
  };

  const runStream = () => {
    setStreaming(true);
    setLoaded(new Set());
    streamedRef.current = new Map();
    void window.launcher.accounts.listStream().catch(() => setStreaming(false));
  };

  useEffect(() => {
    const off = window.launcher.accounts.onCategory(
      ({ serviceId, items, categoryDone, done }) => {
        if (isSupportedService(serviceId) && items.length > 0) {
          const acc = streamedRef.current.get(serviceId) ?? [];
          acc.push(...items);
          streamedRef.current.set(serviceId, acc);
          rebuildFromStream();
        }
        if (categoryDone && isSupportedService(serviceId)) {
          if (!streamedRef.current.has(serviceId)) {
            streamedRef.current.set(serviceId, []);
            rebuildFromStream();
          }
          setLoaded((prev) => new Set(prev).add(serviceId));
        }
        if (done) setStreaming(false);
      },
    );
    if ((qc.getQueryData<AccountSummary[]>(['accounts']) ?? []).length > 0) {
      setLoaded(new Set(SUPPORTED_SERVICES));
    } else {
      runStream();
    }
    return off;
  }, []);

  const rawItems = query.data ?? [];
  const items = useMemo(
    () => rawItems.filter((it) => isSupportedService(it.category)),
    [rawItems],
  );
  const buckets = useMemo(
    () => buildBuckets(items, t('inventory.filter.all'), loaded, streaming),
    [items, t, loaded, streaming],
  );

  const trimmedSearch = search.trim();
  const visible = useMemo(() => {
    const filtered = items.filter(
      (it) =>
        (filter === 'all' || it.category === filter) &&
        matchesQuery(it, trimmedSearch),
    );
    return [...filtered].sort((a, b) => compareItems(a, b, sortKey, sortDir));
  }, [items, filter, trimmedSearch, sortKey, sortDir]);

  useEffect(() => {
    setLimit(CHUNK);
    document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0 });
  }, [filter, trimmedSearch, sortKey, sortDir]);

  const shown = visible.slice(0, limit);
  const hasMore = limit < visible.length;

  const allDone = SUPPORTED_SERVICES.every((id) => loaded.has(id));
  const activeLoading =
    filter === 'all'
      ? streaming && !allDone
      : isSupportedService(filter) && !loaded.has(filter);

  const fullySettled = !streaming && !query.isLoading && !query.isFetching;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setLimit((n) => n + CHUNK);
        }
      },
      { root: node.closest('[data-scroll-root]'), rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, visible.length]);

  const refresh = () => {
    if (streaming) return;
    runStream();
  };

  // Hard error with nothing cached to fall back on.
  if (query.isError && rawItems.length === 0) {
    return (
      <div className={s.state}>
        <AlertCircle size={28} className={s.danger} />
        <p>{t('inventory.error')}</p>
        <button type="button" className={s.retry} onClick={() => query.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (rawItems.length === 0 && fullySettled) {
    return (
      <div className={s.state}>
        <p>{t('inventory.empty')}</p>
        <button
          type="button"
          className={s.retry}
          onClick={() =>
            window.launcher.app.openExternal('https://lzt.market/orders')
          }
        >
          {t('inventory.openMarket')}
        </button>
      </div>
    );
  }

  if (items.length === 0 && fullySettled) {
    return (
      <div className={s.state}>
        <p>{t('inventory.emptyUnsupported')}</p>
        <button
          type="button"
          className={s.retry}
          onClick={() =>
            window.launcher.app.openExternal('https://lzt.market/orders')
          }
        >
          {t('inventory.openMarket')}
        </button>
      </div>
    );
  }

  return (
    <div className={s.view}>
      <div className={s.toolbar}>
        <div className={s.filters}>
          {buckets.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`${s.filter} ${filter === b.id ? s.filterActive : ''}`}
              onClick={() => setFilter(b.id)}
            >
              <span>{b.label}</span>
              {b.loading ? (
                <span className={s.filterCountSkeleton} aria-hidden />
              ) : (
                <span className={s.filterCount}>{b.count}</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={s.refresh}
          onClick={refresh}
          disabled={streaming}
        >
          <RefreshCw size={14} className={streaming ? s.spin : ''} />
          <span>{t('inventory.refresh')}</span>
        </button>
      </div>

      <div className={s.controls}>
        <div className={s.searchBox}>
          <Search size={15} className={s.searchIcon} />
          <input
            type="text"
            className={s.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inventory.searchPlaceholder')}
          />
          {search && (
            <button
              type="button"
              className={s.searchClear}
              onClick={() => setSearch('')}
              aria-label={t('inventory.searchClear')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className={s.sort}>
          <div className={s.sortKeys}>
            {SORT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`${s.sortBtn} ${sortKey === key ? s.sortBtnActive : ''}`}
                onClick={() => setSortKey(key)}
              >
                {t(`inventory.sort.${key}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={s.sortDir}
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={t(sortDir === 'asc' ? 'inventory.sort.asc' : 'inventory.sort.desc')}
          >
            <ArrowDownUp size={14} />
            <span>{t(sortDir === 'asc' ? 'inventory.sort.asc' : 'inventory.sort.desc')}</span>
          </button>
        </div>
      </div>

      {visible.length === 0 && activeLoading ? (
        <div className={s.grid}>
          {Array.from({ length: SKELETON_INITIAL }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className={s.noResults}>
          <Search size={24} className={s.noResultsIcon} />
          <p>{t('inventory.noResults')}</p>
        </div>
      ) : (
        <div key={filter} className={s.grid}>
          {shown.map((item) => (
            <AccountCard key={item.itemId} item={item} />
          ))}
          {!hasMore &&
            activeLoading &&
            Array.from({ length: SKELETON_TAIL }, (_, i) => (
              <SkeletonCard key={`tail-${i}`} />
            ))}
        </div>
      )}

      {hasMore && <div ref={sentinelRef} className={s.sentinel} aria-hidden />}
    </div>
  );
};
