import type { LoginProgressEvent } from '@lolzteam/adapter-contract';
import type {
  AccountDetails,
  AccountSummary,
  AccountTag,
  AuthStatus,
  AuthTokenPayload,
  LauncherSettings,
  PickFileOptions,
  ProxyEntry,
  ServiceId,
  SettingsResponse,
} from '@lolzteam/shared-types';

export type LoginProgress = LoginProgressEvent & { itemId: number };

export interface AccountsCategoryEvent {
  serviceId: ServiceId;
  items: AccountSummary[];
  categoryDone: boolean;
  done: boolean;
  page?: number;
  totalPages?: number | null;
}

export type CheckAccountResult =
  | { ok: true; valid: boolean; tags: AccountTag[]; reason?: string }
  | { ok: false; message: string };

export type ProxyTestResult =
  | { ok: true; ms: number; ip: string }
  | { ok: false; message: string };

export interface ProxyTestInfo {
  ip: string;
  ms: number;
}

export interface BrowserNavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
}

export type NetworkStatus =
  | { online: true; ms: number }
  | { online: false; message: string };

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; notes: string | null }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export const IPC_CHANNELS = {
  AUTH_OPEN_IN_APP: 'auth:open-in-app',
  AUTH_OPEN_BROWSER: 'auth:open-browser',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_STATUS: 'auth:get-status',
  AUTH_TOKEN_RECEIVED: 'auth:token-received',
  AUTH_STATUS_CHANGED: 'auth:status-changed',

  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_LIST_STREAM: 'accounts:list-stream',
  ACCOUNTS_CATEGORY: 'accounts:category',
  ACCOUNTS_REFRESH: 'accounts:refresh',
  ACCOUNTS_CLEAR_CACHE: 'accounts:clear-cache',
  ACCOUNTS_GET: 'accounts:get',
  ACCOUNT_LOGIN: 'account:login',
  ACCOUNT_LOGIN_CANCEL: 'account:login-cancel',
  ACCOUNT_LOGIN_PROGRESS: 'account:login-progress',
  ACCOUNT_CHECK: 'account:check',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_PICK_FILE: 'settings:pick-file',

  STEAM_CLEAR_SESSION: 'steam:clear-session',

  PROXY_TEST: 'proxy:test',

  BROWSER_NAV_BACK: 'browser-nav:back',
  BROWSER_NAV_FORWARD: 'browser-nav:forward',
  BROWSER_NAV_RELOAD: 'browser-nav:reload',
  BROWSER_NAV_STOP: 'browser-nav:stop',
  BROWSER_NAV_GO: 'browser-nav:go',
  BROWSER_NAV_COPY_URL: 'browser-nav:copy-url',
  BROWSER_NAV_OPEN_EXTERNAL: 'browser-nav:open-external',
  BROWSER_NAV_EXPAND: 'browser-nav:expand',
  BROWSER_NAV_COLLAPSE: 'browser-nav:collapse',
  BROWSER_NAV_PROXY_RETEST: 'browser-nav:proxy-retest',
  BROWSER_NAV_STATE: 'browser-nav:state',

  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_PING_API: 'app:ping-api',
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_LOGS: 'app:open-logs',
  APP_EXPORT_LOG: 'app:export-log',

  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface IpcRequestMap {
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: void;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: void;
  [IPC_CHANNELS.AUTH_LOGOUT]: void;
  [IPC_CHANNELS.AUTH_GET_STATUS]: void;
  [IPC_CHANNELS.ACCOUNTS_LIST]: void;
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]: { only?: ServiceId } | void;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: void;
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: void;
  [IPC_CHANNELS.ACCOUNTS_GET]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_LOGIN]: {
    itemId: number;
    method: 'native' | 'web';
    proxyId?: string | null;
    proxyTest?: ProxyTestInfo | null;
  };
  [IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_CHECK]: { itemId: number };
  [IPC_CHANNELS.SETTINGS_GET]: void;
  [IPC_CHANNELS.SETTINGS_SET]: Partial<LauncherSettings>;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: PickFileOptions;
  [IPC_CHANNELS.STEAM_CLEAR_SESSION]: void;
  [IPC_CHANNELS.PROXY_TEST]: Pick<
    ProxyEntry,
    'host' | 'port' | 'username' | 'password'
  >;
  [IPC_CHANNELS.BROWSER_NAV_BACK]: void;
  [IPC_CHANNELS.BROWSER_NAV_FORWARD]: void;
  [IPC_CHANNELS.BROWSER_NAV_RELOAD]: void;
  [IPC_CHANNELS.BROWSER_NAV_STOP]: void;
  [IPC_CHANNELS.BROWSER_NAV_GO]: string;
  [IPC_CHANNELS.BROWSER_NAV_COPY_URL]: void;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL]: void;
  [IPC_CHANNELS.BROWSER_NAV_EXPAND]: void;
  [IPC_CHANNELS.BROWSER_NAV_COLLAPSE]: void;
  [IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST]: void;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: { url: string };
  [IPC_CHANNELS.APP_PING_API]: void;
  [IPC_CHANNELS.APP_GET_VERSION]: void;
  [IPC_CHANNELS.APP_OPEN_LOGS]: void;
  [IPC_CHANNELS.APP_EXPORT_LOG]: void;
  [IPC_CHANNELS.UPDATE_CHECK]: void;
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: void;
  [IPC_CHANNELS.UPDATE_INSTALL]: void;
}

export interface IpcResponseMap {
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: void;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: { state: string };
  [IPC_CHANNELS.AUTH_LOGOUT]: void;
  [IPC_CHANNELS.AUTH_GET_STATUS]: AuthStatus;
  [IPC_CHANNELS.ACCOUNTS_LIST]: AccountSummary[];
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]: void;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: AccountSummary[];
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: void;
  [IPC_CHANNELS.ACCOUNTS_GET]: AccountDetails;
  [IPC_CHANNELS.ACCOUNT_LOGIN]: { ok: boolean; message?: string };
  [IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL]: void;
  [IPC_CHANNELS.ACCOUNT_CHECK]: CheckAccountResult;
  [IPC_CHANNELS.SETTINGS_GET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_SET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: string | null;
  [IPC_CHANNELS.STEAM_CLEAR_SESSION]: { ok: boolean; message?: string };
  [IPC_CHANNELS.PROXY_TEST]: ProxyTestResult;
  [IPC_CHANNELS.BROWSER_NAV_BACK]: void;
  [IPC_CHANNELS.BROWSER_NAV_FORWARD]: void;
  [IPC_CHANNELS.BROWSER_NAV_RELOAD]: void;
  [IPC_CHANNELS.BROWSER_NAV_STOP]: void;
  [IPC_CHANNELS.BROWSER_NAV_GO]: void;
  [IPC_CHANNELS.BROWSER_NAV_COPY_URL]: void;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL]: void;
  [IPC_CHANNELS.BROWSER_NAV_EXPAND]: void;
  [IPC_CHANNELS.BROWSER_NAV_COLLAPSE]: void;
  [IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST]: ProxyTestResult;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: void;
  [IPC_CHANNELS.APP_PING_API]: NetworkStatus;
  [IPC_CHANNELS.APP_GET_VERSION]: string;
  [IPC_CHANNELS.APP_OPEN_LOGS]: void;
  [IPC_CHANNELS.APP_EXPORT_LOG]: { ok: boolean; path?: string };
  [IPC_CHANNELS.UPDATE_CHECK]: void;
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: void;
  [IPC_CHANNELS.UPDATE_INSTALL]: void;
}

export interface IpcEventMap {
  [IPC_CHANNELS.AUTH_TOKEN_RECEIVED]: AuthTokenPayload;
  [IPC_CHANNELS.AUTH_STATUS_CHANGED]: AuthStatus;
  [IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS]: LoginProgress;
  [IPC_CHANNELS.ACCOUNTS_CATEGORY]: AccountsCategoryEvent;
  [IPC_CHANNELS.SETTINGS_CHANGED]: SettingsResponse;
  [IPC_CHANNELS.UPDATE_STATUS]: UpdateStatus;
  [IPC_CHANNELS.BROWSER_NAV_STATE]: BrowserNavState;
}

export type { AuthTokenPayload };
