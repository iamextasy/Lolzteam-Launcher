import type {
  AdapterContext,
  AdapterLogger,
  LoginMethod,
  LoginProgressEvent,
} from '@adapter-contract';
import { IPC_CHANNELS } from '@shared-ipc';
import type { ServiceId } from '@shared-types';
import { BrowserWindow, app, ipcMain } from 'electron';
import log from 'electron-log/main';
import { getAdapter } from '../adapters';
import { fetchEmailCode, fetchSteamMafile, getAccountDetails } from '../services/market';
import { getSettings } from '../settings/settings-store';

const adapterLogger: AdapterLogger = {
  debug: (m, meta) => (meta === undefined ? log.debug(m) : log.debug(m, meta)),
  info: (m, meta) => (meta === undefined ? log.info(m) : log.info(m, meta)),
  warn: (m, meta) => (meta === undefined ? log.warn(m) : log.warn(m, meta)),
  error: (m, meta) => (meta === undefined ? log.error(m) : log.error(m, meta)),
};

const broadcast = (itemId: number, event: LoginProgressEvent): void => {
  const payload = { ...event, itemId };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS, payload);
  }
};

const buildCtx = async (
  itemId: number,
  abortSignal: AbortSignal,
  category: ServiceId | null,
  proxyId?: string | null,
  proxyTest?: { ip: string; ms: number } | null,
): Promise<AdapterContext> => {
  const settings = await getSettings();
  const serviceAllowsProxy = category !== null && settings.proxyServices.includes(category);
  const proxy =
    settings.proxyEnabled && serviceAllowsProxy && proxyId
      ? settings.proxies.find((p) => p.id === proxyId)
      : undefined;
  return {
    log: adapterLogger,
    paths: {
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      temp: app.getPath('temp'),
    },
    abortSignal,
    onProgress: (event) => broadcast(itemId, event),
    fetchEmailCode: (id) => fetchEmailCode(id, abortSignal),
    fetchSteamMafile: (id) => fetchSteamMafile(id),
    settings,
    proxy,
    proxyTest: proxy && proxyTest ? proxyTest : undefined,
  };
};

// One in-flight login per account. Lets ACCOUNT_LOGIN_CANCEL abort a hung
// attempt (e.g. Telegram code never arrives) instead of leaving the modal stuck.
const activeLogins = new Map<number, AbortController>();

export const registerLoginIpc = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.ACCOUNT_LOGIN,
    async (
      _e,
      payload: {
        itemId: number;
        method: LoginMethod;
        proxyId?: string | null;
        proxyTest?: { ip: string; ms: number } | null;
      },
    ) => {
      const { itemId, method, proxyId, proxyTest } = payload;
      activeLogins.get(itemId)?.abort();
      const ctl = new AbortController();
      activeLogins.set(itemId, ctl);
      broadcast(itemId, { step: 'fetching-credentials' });

      const details = await getAccountDetails(itemId);
      if (!details) {
        activeLogins.delete(itemId);
        return { ok: false, message: 'Не удалось получить данные аккаунта' };
      }

      const adapter = getAdapter(details.category);
      if (!adapter) {
        activeLogins.delete(itemId);
        return {
          ok: false,
          message: `Сервис "${details.categoryTitle}" пока не поддерживается`,
        };
      }

      try {
        const ctx = await buildCtx(itemId, ctl.signal, details.category, proxyId, proxyTest);
        const result = await adapter.login(method, details, ctx);
        if (result.ok) broadcast(itemId, { step: 'done' });
        return { ok: result.ok, message: result.message };
      } catch (err) {
        if (ctl.signal.aborted) return { ok: false, message: 'Вход отменён' };
        log.error('[login] adapter threw', err);
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Неизвестная ошибка',
        };
      } finally {
        if (activeLogins.get(itemId) === ctl) activeLogins.delete(itemId);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL, (_e, payload: { itemId: number }) => {
    activeLogins.get(payload.itemId)?.abort();
  });
};
