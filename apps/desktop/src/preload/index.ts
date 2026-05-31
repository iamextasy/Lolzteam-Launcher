import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AccountsCategoryEvent, type LoginProgress } from '@shared-ipc';
import type {
  AccountDetails,
  AccountSummary,
  AuthStatus,
  AuthTokenPayload,
  LauncherSettings,
  PickFileOptions,
  SettingsResponse,
} from '@shared-types';

type Unsubscribe = () => void;

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload);

const on = <T>(channel: string, handler: (payload: T) => void): Unsubscribe => {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

const api = {
  auth: {
    openInApp: () => invoke<void>(IPC_CHANNELS.AUTH_OPEN_IN_APP),
    openBrowser: () => invoke<{ state: string }>(IPC_CHANNELS.AUTH_OPEN_BROWSER),
    logout: () => invoke<void>(IPC_CHANNELS.AUTH_LOGOUT),
    getStatus: () => invoke<AuthStatus>(IPC_CHANNELS.AUTH_GET_STATUS),
    onTokenReceived: (h: (p: AuthTokenPayload) => void) =>
      on<AuthTokenPayload>(IPC_CHANNELS.AUTH_TOKEN_RECEIVED, h),
    onStatusChanged: (h: (p: AuthStatus) => void) =>
      on<AuthStatus>(IPC_CHANNELS.AUTH_STATUS_CHANGED, h),
  },
  accounts: {
    list: () => invoke<AccountSummary[]>(IPC_CHANNELS.ACCOUNTS_LIST),
    listStream: () => invoke<void>(IPC_CHANNELS.ACCOUNTS_LIST_STREAM),
    onCategory: (h: (p: AccountsCategoryEvent) => void) =>
      on<AccountsCategoryEvent>(IPC_CHANNELS.ACCOUNTS_CATEGORY, h),
    refresh: () => invoke<AccountSummary[]>(IPC_CHANNELS.ACCOUNTS_REFRESH),
    clearCache: () => invoke<void>(IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE),
    get: (itemId: number) =>
      invoke<AccountDetails | null>(IPC_CHANNELS.ACCOUNTS_GET, { itemId }),
    login: (itemId: number, method: 'native' | 'web' = 'native') =>
      invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.ACCOUNT_LOGIN, {
        itemId,
        method,
      }),
    onLoginProgress: (h: (p: LoginProgress) => void) =>
      on<LoginProgress>(IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS, h),
  },
  settings: {
    get: () => invoke<SettingsResponse>(IPC_CHANNELS.SETTINGS_GET),
    set: (patch: Partial<LauncherSettings>) =>
      invoke<SettingsResponse>(IPC_CHANNELS.SETTINGS_SET, patch),
    pickFile: (opts: PickFileOptions) =>
      invoke<string | null>(IPC_CHANNELS.SETTINGS_PICK_FILE, opts),
    onChanged: (h: (s: SettingsResponse) => void) =>
      on<SettingsResponse>(IPC_CHANNELS.SETTINGS_CHANGED, h),
  },
  app: {
    getVersion: () => invoke<string>(IPC_CHANNELS.APP_GET_VERSION),
    openExternal: (url: string) =>
      invoke<void>(IPC_CHANNELS.APP_OPEN_EXTERNAL, { url }),
  },
} as const;

export type LauncherApi = typeof api;

contextBridge.exposeInMainWorld('launcher', api);
