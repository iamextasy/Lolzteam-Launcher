import { IPC_CHANNELS } from '@shared-ipc';
import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { clearSteamSession } from '../adapters/steam/clear-session';

export const registerSteamIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.STEAM_CLEAR_SESSION, async () => {
    log.info('[steam] clearing local session data');
    try {
      const result = await clearSteamSession();
      if (result.ok) log.info('[steam] session data cleared');
      else log.warn(`[steam] clear session skipped: ${result.message}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[steam] clear session failed', err);
      return { ok: false, message };
    }
  });
};
