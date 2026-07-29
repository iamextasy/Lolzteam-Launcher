import { LOLZ_CONFIG } from '@shared-ipc';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log/main';
import { registerInAppAuth } from './auth/in-app-auth';
import { registerAuthFlow } from './auth/protocol-handler';
import { registerProtocol } from './auth/protocol-register';
import { bootstrap } from './bootstrap';
import { registerAccountsIpc } from './ipc/accounts';
import { registerAppIpc } from './ipc/app';
import { registerAuthIpc } from './ipc/auth';
import { registerLoginIpc } from './ipc/login';
import { registerProfileIpc } from './ipc/profile';
import { registerProxyIpc } from './ipc/proxy';
import { registerSettingsIpc } from './ipc/settings';
import { registerSteamIpc } from './ipc/steam';
import { registerGiftsIpc } from './ipc/gifts';
import { initAppProxy } from './services/api-session';
import { registerProxyAuthHandler } from './services/proxy';
import { getCachedSettings } from './settings/settings-store';
import { registerUpdaterIpc } from './updater';
import { createMainWindow, getMainWindow, setQuitting, showMainWindow } from './window/main-window';
import { createTray } from './window/tray';

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

app.disableHardwareAcceleration();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let handleDeepLink: ((url: string) => void) | null = null;

const consumeDeepLinks = (argv: string[]) => {
  if (!handleDeepLink) return;
  const prefix = `${LOLZ_CONFIG.protocolScheme}://`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) handleDeepLink(arg);
  }
};

app.on('second-instance', (_event, argv) => {
  showMainWindow();
  consumeDeepLinks(argv);
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink?.(url);
});

app.whenReady().then(async () => {
  await bootstrap();
  await registerProtocol(LOLZ_CONFIG.protocolScheme);

  registerProxyAuthHandler();
  await initAppProxy();

  const win = createMainWindow();
  try {
    createTray();
  } catch (err) {
    log.warn('[boot] tray init failed', err);
  }
  handleDeepLink = registerAuthFlow(() => getMainWindow());
  registerInAppAuth(() => getMainWindow());
  registerAuthIpc();
  registerAppIpc();
  registerAccountsIpc();
  registerLoginIpc();
  registerProfileIpc();
  registerSettingsIpc();
  registerSteamIpc();
  registerGiftsIpc();
  registerProxyIpc();
  registerUpdaterIpc();

  consumeDeepLinks(process.argv);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  log.info(`[boot] window created (${win.id})`);
});

app.on('before-quit', () => setQuitting(true));

app.on('window-all-closed', () => {
  const minimize = getCachedSettings()?.minimizeToTray ?? true;
  if (process.platform !== 'darwin' && !minimize) app.quit();
});
