import type { LoginProgressEvent } from '@lolzteam/adapter-contract';
import type {
  AccountDetails,
  AccountSummary,
  AuthStatus,
  AuthTokenPayload,
  LauncherSettings,
  PickFileOptions,
  ServiceId,
  SettingsResponse,
} from '@lolzteam/shared-types';

export type LoginProgress = LoginProgressEvent & { itemId: number };

export interface AccountsCategoryEvent {
  serviceId: ServiceId;
  items: AccountSummary[];
  categoryDone: boolean;
  done: boolean;
}

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
  ACCOUNT_LOGIN_PROGRESS: 'account:login-progress',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_PICK_FILE: 'settings:pick-file',

  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_GET_VERSION: 'app:get-version',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface IpcRequestMap {
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: void;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: void;
  [IPC_CHANNELS.AUTH_LOGOUT]: void;
  [IPC_CHANNELS.AUTH_GET_STATUS]: void;
  [IPC_CHANNELS.ACCOUNTS_LIST]: void;
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]: void;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: void;
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: void;
  [IPC_CHANNELS.ACCOUNTS_GET]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_LOGIN]: { itemId: number; method: 'native' | 'web' };
  [IPC_CHANNELS.SETTINGS_GET]: void;
  [IPC_CHANNELS.SETTINGS_SET]: Partial<LauncherSettings>;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: PickFileOptions;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: { url: string };
  [IPC_CHANNELS.APP_GET_VERSION]: void;
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
  [IPC_CHANNELS.SETTINGS_GET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_SET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: string | null;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: void;
  [IPC_CHANNELS.APP_GET_VERSION]: string;
}

export interface IpcEventMap {
  [IPC_CHANNELS.AUTH_TOKEN_RECEIVED]: AuthTokenPayload;
  [IPC_CHANNELS.AUTH_STATUS_CHANGED]: AuthStatus;
  [IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS]: LoginProgress;
  [IPC_CHANNELS.ACCOUNTS_CATEGORY]: AccountsCategoryEvent;
  [IPC_CHANNELS.SETTINGS_CHANGED]: SettingsResponse;
}

export type { AuthTokenPayload };
