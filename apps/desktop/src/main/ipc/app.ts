import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC_CHANNELS, LOLZ_CONFIG, type NetworkStatus } from '@shared-ipc';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';

const ALLOWED_URL_PREFIXES = ['https://', 'http://'];

const PING_TIMEOUT_MS = 8000;

// Any HTTP response (even 401) proves the API is reachable; only a transport
// error (DNS/connect/timeout) means the user is offline or lzt is blocked.
const pingApi = async (): Promise<NetworkStatus> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const started = Date.now();
  try {
    await fetch(`${LOLZ_CONFIG.marketApiUrl}/me`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return { online: true, ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    return { online: false, message };
  } finally {
    clearTimeout(timer);
  }
};

const logsDir = () => app.getPath('logs');
const logFile = () => join(logsDir(), 'main.log');

export const registerAppIpc = () => {
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_e, payload: { url: string }) => {
    const url = payload?.url;
    if (typeof url !== 'string') throw new Error('url is required');
    if (!ALLOWED_URL_PREFIXES.some((p) => url.startsWith(p))) {
      throw new Error('only http(s) urls are allowed');
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS.APP_PING_API, () => pingApi());

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_LOGS, async () => {
    await shell.openPath(logsDir());
  });

  ipcMain.handle(IPC_CHANNELS.APP_EXPORT_LOG, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const opts = {
      title: 'Export log',
      defaultPath: `lolzteam-launcher-${stamp}.log`,
      filters: [{ name: 'Log', extensions: ['log'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { ok: false };
    await copyFile(logFile(), result.filePath);
    return { ok: true, path: result.filePath };
  });
};
