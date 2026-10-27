import { LOLZ_CONFIG } from '@shared-ipc';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log/main';
import { registerInAppAuth } from './auth/in-app-auth';
import { registerAuthFlow } from './auth/protocol-handler';
import { registerProtocol } from './auth/protocol-register';
import { bootstrap } from './bootstrap';
import { registerAccountsIpc } from './ipc/accounts';
import { registerActionLogIpc } from './ipc/action-log';
import { registerAppIpc } from './ipc/app';
import { registerAuthIpc } from './ipc/auth';
import { registerExtensionsIpc } from './ipc/extensions';
import { registerLocalAccountsIpc } from './ipc/local-accounts';
import { registerLoginIpc } from './ipc/login';
import { registerMetricsIpc } from './ipc/metrics';
import { registerNotifyIpc } from './ipc/notify';
import { registerProfileIpc } from './ipc/profile';
import { registerProxyIpc } from './ipc/proxy';
import { registerSettingsIpc } from './ipc/settings';
import { registerSteamIpc } from './ipc/steam';
import { registerSteamGuardIpc } from './ipc/steam-guard';
import { registerTelegramIpc } from './ipc/telegram-base';
import { buildBrowserUserAgent } from './lib/user-agent';
import { initAppProxy } from './services/api-session';
import { registerConfirmIpc } from './services/confirm-broker';
import { initExtensions } from './services/extensions';
import { initMetrics } from './services/metrics';
import { registerProxyAuthHandler } from './services/proxy';
import { registerUpdaterIpc } from './updater';
import {
  createMainWindow,
  getMainWindow,
  setQuitting,
  shouldMinimizeToTray,
  showMainWindow,
} from './window/main-window';
import { createTray } from './window/tray';

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandled rejection', reason);
});

app.disableHardwareAcceleration();

app.setAppUserModelId('com.lolzteam.launcher');

app.userAgentFallback = buildBrowserUserAgent(process.versions.chrome, process.platform);

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
  registerConfirmIpc();
  // Not awaited: after an update it re-patches whole extensions, and a login waits for it by itself anyway.
  void initExtensions().catch((err: unknown) =>
    log.error('[boot] extensions failed to start', err),
  );

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
  registerActionLogIpc();
  registerAccountsIpc();
  registerLocalAccountsIpc();
  registerLoginIpc();
  registerProfileIpc();
  registerSettingsIpc();
  registerSteamIpc();
  registerSteamGuardIpc();
  registerTelegramIpc();
  registerProxyIpc();
  registerExtensionsIpc();
  registerNotifyIpc();
  registerMetricsIpc();
  registerUpdaterIpc();

  initMetrics();

  consumeDeepLinks(process.argv);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  log.info(`[boot] window created (${win.id})`);
});

app.on('before-quit', () => setQuitting(true));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !shouldMinimizeToTray()) app.quit();
});
