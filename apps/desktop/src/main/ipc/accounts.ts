import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared-ipc';
import {
  getAccountDetails,
  listAccountsByCategory,
  listPurchasedAccounts,
} from '../services/market';
import {
  clearCachedAccounts,
  loadCachedAccounts,
  saveCachedAccounts,
} from '../services/accounts-cache-store';
import { onTokenChange } from '../auth/token-store';
import { SERVICE_CATEGORY_ID } from '@shared-types';
import type { AccountSummary, ServiceId } from '@shared-types';

const STREAM_ORDER: readonly ServiceId[] = ['steam', 'telegram', 'tiktok'] as const;

let inflight: Promise<AccountSummary[]> | null = null;

const fetchAndCache = (): Promise<AccountSummary[]> => {
  if (inflight) return inflight;
  const p = listPurchasedAccounts()
    .then(async (items) => {
      if (items.length > 0) await saveCachedAccounts(items);
      return items;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
};

const loadCached = async (): Promise<AccountSummary[]> => {
  const cached = await loadCachedAccounts();
  return cached?.items ?? [];
};

let streaming = false;

const streamCategories = async (event: IpcMainInvokeEvent): Promise<void> => {
  if (streaming) return;
  streaming = true;
  const send = (payload: Parameters<typeof event.sender.send>[1]) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC_CHANNELS.ACCOUNTS_CATEGORY, payload);
    }
  };
  const all: AccountSummary[] = [];
  try {
    for (const serviceId of STREAM_ORDER) {
      const categoryId = SERVICE_CATEGORY_ID[serviceId];
      if (categoryId === undefined) continue;
      await listAccountsByCategory(categoryId, (pageItems) => {
        all.push(...pageItems);
        send({ serviceId, items: pageItems, categoryDone: false, done: false });
      });
      send({ serviceId, items: [], categoryDone: true, done: false });
    }
    if (all.length > 0) await saveCachedAccounts(all);
    const last = STREAM_ORDER[STREAM_ORDER.length - 1] as ServiceId;
    send({ serviceId: last, items: [], categoryDone: true, done: true });
  } finally {
    streaming = false;
  }
};

export const registerAccountsIpc = () => {
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_LIST, () => loadCached());
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_LIST_STREAM, (event) => streamCategories(event));
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_REFRESH, () => fetchAndCache());
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE, async () => {
    inflight = null;
    await clearCachedAccounts();
  });
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_GET, (_e, payload: { itemId: number }) =>
    getAccountDetails(payload.itemId),
  );

  onTokenChange(() => {
    inflight = null;
    void clearCachedAccounts();
  });
};
