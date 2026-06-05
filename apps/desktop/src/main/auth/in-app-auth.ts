import { IPC_CHANNELS, LOLZ_CONFIG } from '@shared-ipc';
import { BrowserWindow, ipcMain } from 'electron';
import { MAIN_COLORS } from '../theme';
import { acceptAuthCallback, clearAuthSession, issueState } from './auth-broker';

type GetWindow = () => BrowserWindow | null;

const AUTH_PARTITION = 'persist:lolz-auth';
const REDIRECT_SCHEMES = [`${LOLZ_CONFIG.protocolScheme}://`, 'lzt://'];

let authWindow: BrowserWindow | null = null;

const buildAuthUrl = (state: string) => {
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: LOLZ_CONFIG.clientId,
    redirect_uri: LOLZ_CONFIG.authRedirectUri,
    scope: LOLZ_CONFIG.oauthScopes,
    state,
  });
  return `${LOLZ_CONFIG.webUrl}/account/authorize?${params.toString()}`;
};

const closeAuthWindow = () => {
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  authWindow = null;
};

const openAuthWindow = async (getMainWindow: GetWindow) => {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return;
  }

  await clearAuthSession(AUTH_PARTITION);

  const state = issueState();
  const authUrl = buildAuthUrl(state);

  const parent = getMainWindow() ?? undefined;
  authWindow = new BrowserWindow({
    width: 520,
    height: 720,
    parent,
    modal: false,
    backgroundColor: MAIN_COLORS.bg,
    title: 'Вход в LOLZTEAM',
    autoHideMenuBar: true,
    webPreferences: {
      partition: AUTH_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  authWindow.setMenu(null);

  const intercept = async (url: string, evt?: Electron.Event) => {
    const isRedirect = REDIRECT_SCHEMES.some((s) => url.startsWith(s));
    if (!isRedirect) return false;
    evt?.preventDefault();
    const outcome = await acceptAuthCallback(url, getMainWindow);
    if (outcome.ok || outcome.reason === 'duplicate') {
      closeAuthWindow();
      void clearAuthSession(AUTH_PARTITION);
    }
    return true;
  };

  authWindow.webContents.on('will-redirect', (e, url) => {
    void intercept(url, e);
  });
  authWindow.webContents.on('will-navigate', (e, url) => {
    void intercept(url, e);
  });
  authWindow.webContents.on('did-fail-load', (_e, _ec, _desc, url) => {
    void intercept(url);
  });

  authWindow.on('closed', () => {
    authWindow = null;
  });

  await authWindow.loadURL(authUrl);
};

export const registerInAppAuth = (getMainWindow: GetWindow) => {
  ipcMain.handle(IPC_CHANNELS.AUTH_OPEN_IN_APP, async () => {
    await openAuthWindow(getMainWindow);
  });
};
