export type PageCursor = { after: string } | { page: number };

export const readNextPage = (body: unknown): PageCursor | null | undefined => {
  if (typeof body !== 'object' || body === null || !('nextPageHref' in body)) return undefined;
  const href = (body as { nextPageHref?: unknown }).nextPageHref;
  if (href === null || href === false || href === '') return null;
  if (typeof href !== 'string') return undefined;

  let params: URLSearchParams;
  try {
    params = new URL(href, 'https://lzt.market/').searchParams;
  } catch {
    return undefined;
  }
  const after = params.get('after');
  if (after) return { after };
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page > 0 ? { page } : undefined;
};

export const applyCursor = (search: URLSearchParams, cursor: PageCursor | undefined): void => {
  if (!cursor) return;
  if ('after' in cursor) search.set('after', cursor.after);
  else search.set('page', String(cursor.page));
};
