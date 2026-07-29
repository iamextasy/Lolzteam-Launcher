import {
  type GiftsListResult,
  type GiftsTransferProgress,
  type GiftsTransferResult,
  IPC_CHANNELS,
  type IpcRequestMap,
} from '@shared-ipc';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import { SteamWebError, listAccountGifts, transferAccountGifts } from '../adapters/steam/web';
import { getAccountDetails } from '../services/market';
import { getSettings } from '../settings/settings-store';

const activeTransfers = new Map<number, AbortController>();

const resolveProxy = async (proxyId?: string | null) => {
  const settings = await getSettings();
  if (!settings.proxyEnabled || !proxyId) return null;
  if (!settings.proxyServices.includes('steam')) return null;
  return settings.proxies.find((p) => p.id === proxyId) ?? null;
};

const broadcastProgress = (payload: GiftsTransferProgress): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_PROGRESS, payload);
    }
  }
};

export const registerGiftsIpc = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.ACCOUNT_GIFTS_LIST,
    async (
      _e,
      payload: IpcRequestMap[typeof IPC_CHANNELS.ACCOUNT_GIFTS_LIST],
    ): Promise<GiftsListResult> => {
      try {
        const account = await getAccountDetails(payload.itemId);
        if (!account) return { ok: false, message: 'Не удалось получить данные аккаунта' };
        const proxy = await resolveProxy(payload.proxyId);
        const gifts = await listAccountGifts({ account, proxy });
        return { ok: true, gifts };
      } catch (err) {
        const message =
          err instanceof SteamWebError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        log.warn('[gifts] list failed', err);
        return { ok: false, message };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER,
    async (
      _e,
      payload: IpcRequestMap[typeof IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER],
    ): Promise<GiftsTransferResult> => {
      activeTransfers.get(payload.itemId)?.abort();
      const ctl = new AbortController();
      activeTransfers.set(payload.itemId, ctl);

      try {
        const account = await getAccountDetails(payload.itemId);
        if (!account) {
          return {
            ok: false,
            okCount: 0,
            failCount: 1,
            errors: [],
            message: 'Не удалось получить данные аккаунта',
          };
        }
        const proxy = await resolveProxy(payload.proxyId);
        return await transferAccountGifts({
          account,
          destKind: payload.destKind,
          pairs: payload.pairs,
          giftNames: payload.giftNames,
          proxy,
          signal: ctl.signal,
          onProgress: (p) => broadcastProgress({ ...p, itemId: payload.itemId }),
        });
      } catch (err) {
        const message =
          err instanceof SteamWebError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        log.warn('[gifts] transfer failed', err);
        return { ok: false, okCount: 0, failCount: 1, errors: [], message };
      } finally {
        if (activeTransfers.get(payload.itemId) === ctl) activeTransfers.delete(payload.itemId);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_CANCEL,
    async (_e, payload: IpcRequestMap[typeof IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_CANCEL]) => {
      activeTransfers.get(payload.itemId)?.abort();
      activeTransfers.delete(payload.itemId);
    },
  );
};
