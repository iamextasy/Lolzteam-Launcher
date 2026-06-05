import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AccountSummary } from '@shared-types';
import { app } from 'electron';
import log from 'electron-log/main';

const FILE_NAME = 'accounts-cache.json';

const CACHE_VERSION = 2;

const cacheFile = () => join(app.getPath('userData'), FILE_NAME);

interface CachePayload {
  version: number;
  fetchedAt: number;
  items: AccountSummary[];
}

// Only the public AccountSummary list is persisted. AccountDetails (logins,
// passwords, 2FA secrets) is fetched live per-login and never touches disk.
class AccountsCacheStore {
  private cached: CachePayload | null | undefined = undefined;

  async load(): Promise<CachePayload | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const raw = await fs.readFile(cacheFile(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<CachePayload>;
      this.cached =
        parsed.version === CACHE_VERSION &&
        Array.isArray(parsed.items) &&
        typeof parsed.fetchedAt === 'number'
          ? { version: CACHE_VERSION, fetchedAt: parsed.fetchedAt, items: parsed.items }
          : null;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[accounts-cache] failed to load', err);
      }
      this.cached = null;
    }
    return this.cached;
  }

  async save(items: AccountSummary[]): Promise<CachePayload> {
    const payload: CachePayload = { version: CACHE_VERSION, fetchedAt: Date.now(), items };
    try {
      await fs.writeFile(cacheFile(), JSON.stringify(payload), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (err) {
      log.warn('[accounts-cache] failed to write', err);
    }
    this.cached = payload;
    return payload;
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(cacheFile());
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[accounts-cache] failed to remove', err);
      }
    }
    this.cached = null;
  }
}

const store = new AccountsCacheStore();

export const loadCachedAccounts = (): Promise<CachePayload | null> => store.load();
export const saveCachedAccounts = (items: AccountSummary[]): Promise<CachePayload> =>
  store.save(items);
export const clearCachedAccounts = (): Promise<void> => store.clear();
