import { IPC_CHANNELS } from '@shared-ipc';
import type { LauncherSettings, PickFileOptions, SettingsResponse } from '@shared-types';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { resolveEffectiveLocale } from '../settings/locale';
import { getSettings, onSettingsChange, setSettings } from '../settings/settings-store';

const respond = (settings: LauncherSettings): SettingsResponse => ({
  settings,
  effectiveLocale: resolveEffectiveLocale(settings.locale),
});

export const registerSettingsIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => respond(await getSettings()));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_e, patch: Partial<LauncherSettings>) =>
    respond(await setSettings(patch)),
  );

  ipcMain.handle(IPC_CHANNELS.SETTINGS_PICK_FILE, async (event, opts: PickFileOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: opts.title,
          filters: opts.filters,
          defaultPath: opts.defaultPath,
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          title: opts.title,
          filters: opts.filters,
          defaultPath: opts.defaultPath,
          properties: ['openFile'],
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  onSettingsChange((settings) => {
    const payload = respond(settings);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, payload);
      }
    }
  });
};
