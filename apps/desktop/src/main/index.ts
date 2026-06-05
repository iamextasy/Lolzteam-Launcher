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
import { registerProxyIpc } from './ipc/proxy';
import { registerSettingsIpc } from './ipc/settings';
import { registerSteamIpc } from './ipc/steam';
import { registerProxyAuthHandler } from './services/proxy';
import { registerUpdaterIpc } from './updater';
import { createMainWindow, getMainWindow } from './window/main-window';

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
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  consumeDeepLinks(argv);
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink?.(url);
});

app.whenReady().then(async () => {
  await bootstrap();
  await registerProtocol(LOLZ_CONFIG.protocolScheme);

  const win = createMainWindow();
  handleDeepLink = registerAuthFlow(() => getMainWindow());
  registerInAppAuth(() => getMainWindow());
  registerAuthIpc();
  registerAppIpc();
  registerAccountsIpc();
  registerLoginIpc();
  registerSettingsIpc();
  registerSteamIpc();
  registerProxyIpc();
  registerProxyAuthHandler();
  registerUpdaterIpc();

  consumeDeepLinks(process.argv);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  log.info(`[boot] window created (${win.id})`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
