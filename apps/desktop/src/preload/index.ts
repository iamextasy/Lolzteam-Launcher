import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AccountsCategoryEvent,
  type CheckAccountResult,
  type LoginProgress,
  type NetworkStatus,
  type ProxyTestResult,
  type UpdateStatus,
} from '@shared-ipc';
import type {
  AccountDetails,
  AccountSummary,
  AuthStatus,
  AuthTokenPayload,
  LauncherSettings,
  PickFileOptions,
  ProxyEntry,
  ServiceId,
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
    listStream: (only?: ServiceId) =>
      invoke<void>(IPC_CHANNELS.ACCOUNTS_LIST_STREAM, only ? { only } : undefined),
    onCategory: (h: (p: AccountsCategoryEvent) => void) =>
      on<AccountsCategoryEvent>(IPC_CHANNELS.ACCOUNTS_CATEGORY, h),
    refresh: () => invoke<AccountSummary[]>(IPC_CHANNELS.ACCOUNTS_REFRESH),
    clearCache: () => invoke<void>(IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE),
    get: (itemId: number) =>
      invoke<AccountDetails | null>(IPC_CHANNELS.ACCOUNTS_GET, { itemId }),
    login: (
      itemId: number,
      method: 'native' | 'web' = 'native',
      proxyId?: string | null,
      proxyTest?: { ip: string; ms: number } | null,
    ) =>
      invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.ACCOUNT_LOGIN, {
        itemId,
        method,
        proxyId,
        proxyTest,
      }),
    cancelLogin: (itemId: number) =>
      invoke<void>(IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL, { itemId }),
    check: (itemId: number) =>
      invoke<CheckAccountResult>(IPC_CHANNELS.ACCOUNT_CHECK, { itemId }),
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
  steam: {
    clearSession: () =>
      invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.STEAM_CLEAR_SESSION),
  },
  proxy: {
    test: (input: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password'>) =>
      invoke<ProxyTestResult>(IPC_CHANNELS.PROXY_TEST, input),
  },
  app: {
    getVersion: () => invoke<string>(IPC_CHANNELS.APP_GET_VERSION),
    pingApi: () => invoke<NetworkStatus>(IPC_CHANNELS.APP_PING_API),
    openExternal: (url: string) =>
      invoke<void>(IPC_CHANNELS.APP_OPEN_EXTERNAL, { url }),
    openLogs: () => invoke<void>(IPC_CHANNELS.APP_OPEN_LOGS),
    exportLog: () =>
      invoke<{ ok: boolean; path?: string }>(IPC_CHANNELS.APP_EXPORT_LOG),
  },
  updater: {
    check: () => invoke<void>(IPC_CHANNELS.UPDATE_CHECK),
    download: () => invoke<void>(IPC_CHANNELS.UPDATE_DOWNLOAD),
    install: () => invoke<void>(IPC_CHANNELS.UPDATE_INSTALL),
    onStatus: (h: (p: UpdateStatus) => void) =>
      on<UpdateStatus>(IPC_CHANNELS.UPDATE_STATUS, h),
  },
} as const;

export type LauncherApi = typeof api;

contextBridge.exposeInMainWorld('launcher', api);
