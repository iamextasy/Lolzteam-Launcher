import type { LoginProgressEvent } from '@lolzteam/adapter-contract';
import type {
  AccountDetails,
  AccountScope,
  AccountSummary,
  AccountTag,
  AuthStatus,
  AuthTokenPayload,
  LauncherSettings,
  MailLettersRequest,
  MailLettersResult,
  MarketCurrency,
  PickFileOptions,
  ProxyEntry,
  ServiceId,
  SettingsResponse,
  UserLabel,
} from '@lolzteam/shared-types';

export type LoginProgress = LoginProgressEvent & { itemId: number };

export type TagOpResult = { ok: true } | { ok: false; message: string };

export type LabelMutationResult =
  | { ok: true; labels: UserLabel[] }
  | { ok: false; message: string };

export interface AccountsCategoryEvent {
  streamId: number;
  serviceId: ServiceId;
  scope: AccountScope;
  items: AccountSummary[];
  categoryDone: boolean;
  done: boolean;
  page?: number;
  totalPages?: number | null;
}

export type CheckAccountResult =
  | { ok: true; valid: boolean; tags: AccountTag[]; reason?: string }
  | { ok: false; message: string };

export type ProxyTestResult = { ok: true; ms: number; ip: string } | { ok: false; message: string };

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

export type NetworkStatus = { online: true; ms: number } | { online: false; message: string };

export type SteamGiftItem = {
  id: string;
  name: string;
  marketHashName: string;
  iconUrl: string | null;
  timed: boolean;
  regional: boolean;
  restrictionCountries: string | null;
  tradable: boolean;
  alreadySent: boolean;
};

export type GiftsDestKind = 'email' | 'invite';

export type GiftTransferPair = {
  assetId: string;
  recipient: string;
};

export type GiftsListResult = { ok: true; gifts: SteamGiftItem[] } | { ok: false; message: string };

export type GiftsTransferProgress = {
  itemId: number;
  done: number;
  total: number;
  assetId: string;
  giftName: string;
  recipient: string;
};

export type GiftsTransferError = {
  assetId: string;
  giftName: string;
  recipient: string;
  message: string;
};

export type GiftsTransferResult = {
  ok: boolean;
  okCount: number;
  failCount: number;
  errors: GiftsTransferError[];
  message?: string;
};

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
  ACCOUNT_LOGIN_REQUEST: 'account:login-request',
  ACCOUNT_CHECK: 'account:check',
  ACCOUNT_ADD_TAG: 'account:add-tag',
  ACCOUNT_REMOVE_TAG: 'account:remove-tag',

  PROFILE_LABELS_GET: 'profile:labels-get',
  PROFILE_LABELS_REFRESH: 'profile:labels-refresh',
  PROFILE_SET_CURRENCY: 'profile:set-currency',
  PROFILE_LABEL_CREATE: 'profile:label-create',
  PROFILE_LABEL_UPDATE: 'profile:label-update',
  PROFILE_LABEL_DELETE: 'profile:label-delete',
  PROFILE_LABEL_REORDER: 'profile:label-reorder',

  MAIL_GET_LETTERS: 'mail:get-letters',
  MAIL_OPEN_REQUEST: 'mail:open-request',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_PICK_FILE: 'settings:pick-file',

  STEAM_CLEAR_SESSION: 'steam:clear-session',

  ACCOUNT_GIFTS_LIST: 'account:gifts-list',
  ACCOUNT_GIFTS_TRANSFER: 'account:gifts-transfer',
  ACCOUNT_GIFTS_TRANSFER_PROGRESS: 'account:gifts-transfer-progress',
  ACCOUNT_GIFTS_TRANSFER_CANCEL: 'account:gifts-transfer-cancel',

  PROXY_TEST: 'proxy:test',
  PROXY_FETCH_MARKET: 'proxy:fetch-market',

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
  BROWSER_NAV_OPEN_EMAIL: 'browser-nav:open-email',
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
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: undefined;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: undefined;
  [IPC_CHANNELS.AUTH_LOGOUT]: undefined;
  [IPC_CHANNELS.AUTH_GET_STATUS]: undefined;
  [IPC_CHANNELS.ACCOUNTS_LIST]: undefined;
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]:
    | { only?: ServiceId; scope?: AccountScope; streamId?: number }
    | undefined;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: undefined;
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: undefined;
  [IPC_CHANNELS.ACCOUNTS_GET]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_LOGIN]: {
    itemId: number;
    method: 'native' | 'web';
    proxyId?: string | null;
    proxyTest?: ProxyTestInfo | null;
  };
  [IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_CHECK]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_ADD_TAG]: { itemId: number; tagId: number };
  [IPC_CHANNELS.ACCOUNT_REMOVE_TAG]: { itemId: number; tagId: number };
  [IPC_CHANNELS.PROFILE_LABELS_GET]: undefined;
  [IPC_CHANNELS.PROFILE_LABELS_REFRESH]: undefined;
  [IPC_CHANNELS.PROFILE_SET_CURRENCY]: { currency: MarketCurrency };
  [IPC_CHANNELS.PROFILE_LABEL_CREATE]: { title: string; bc: string };
  [IPC_CHANNELS.PROFILE_LABEL_UPDATE]: { tagId: number; title: string; bc: string };
  [IPC_CHANNELS.PROFILE_LABEL_DELETE]: { tagId: number };
  [IPC_CHANNELS.PROFILE_LABEL_REORDER]: { tagIds: number[] };
  [IPC_CHANNELS.MAIL_GET_LETTERS]: MailLettersRequest;
  [IPC_CHANNELS.SETTINGS_GET]: undefined;
  [IPC_CHANNELS.SETTINGS_SET]: Partial<LauncherSettings>;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: PickFileOptions;
  [IPC_CHANNELS.STEAM_CLEAR_SESSION]: undefined;
  [IPC_CHANNELS.ACCOUNT_GIFTS_LIST]: {
    itemId: number;
    proxyId?: string | null;
    proxyTest?: ProxyTestInfo | null;
  };
  [IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER]: {
    itemId: number;
    destKind: GiftsDestKind;
    pairs: GiftTransferPair[];
    giftNames?: Record<string, string>;
    proxyId?: string | null;
    proxyTest?: ProxyTestInfo | null;
  };
  [IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_CANCEL]: { itemId: number };
  [IPC_CHANNELS.PROXY_TEST]: Pick<
    ProxyEntry,
    'host' | 'port' | 'username' | 'password' | 'protocol'
  >;
  [IPC_CHANNELS.PROXY_FETCH_MARKET]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_BACK]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_FORWARD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_RELOAD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_STOP]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_GO]: string;
  [IPC_CHANNELS.BROWSER_NAV_COPY_URL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_EXPAND]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_COLLAPSE]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EMAIL]: undefined;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: { url: string };
  [IPC_CHANNELS.APP_PING_API]: undefined;
  [IPC_CHANNELS.APP_GET_VERSION]: undefined;
  [IPC_CHANNELS.APP_OPEN_LOGS]: undefined;
  [IPC_CHANNELS.APP_EXPORT_LOG]: undefined;
  [IPC_CHANNELS.UPDATE_CHECK]: undefined;
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: undefined;
  [IPC_CHANNELS.UPDATE_INSTALL]: undefined;
}

export interface IpcResponseMap {
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: undefined;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: { state: string };
  [IPC_CHANNELS.AUTH_LOGOUT]: undefined;
  [IPC_CHANNELS.AUTH_GET_STATUS]: AuthStatus;
  [IPC_CHANNELS.ACCOUNTS_LIST]: AccountSummary[];
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]: undefined;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: AccountSummary[];
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: undefined;
  [IPC_CHANNELS.ACCOUNTS_GET]: AccountDetails;
  [IPC_CHANNELS.ACCOUNT_LOGIN]: { ok: boolean; message?: string };
  [IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL]: undefined;
  [IPC_CHANNELS.ACCOUNT_CHECK]: CheckAccountResult;
  [IPC_CHANNELS.ACCOUNT_ADD_TAG]: TagOpResult;
  [IPC_CHANNELS.ACCOUNT_REMOVE_TAG]: TagOpResult;
  [IPC_CHANNELS.PROFILE_LABELS_GET]: UserLabel[];
  [IPC_CHANNELS.PROFILE_LABELS_REFRESH]: UserLabel[];
  [IPC_CHANNELS.PROFILE_SET_CURRENCY]: { ok: boolean; message?: string };
  [IPC_CHANNELS.PROFILE_LABEL_CREATE]: LabelMutationResult;
  [IPC_CHANNELS.PROFILE_LABEL_UPDATE]: LabelMutationResult;
  [IPC_CHANNELS.PROFILE_LABEL_DELETE]: LabelMutationResult;
  [IPC_CHANNELS.PROFILE_LABEL_REORDER]: LabelMutationResult;
  [IPC_CHANNELS.MAIL_GET_LETTERS]: MailLettersResult;
  [IPC_CHANNELS.SETTINGS_GET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_SET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: string | null;
  [IPC_CHANNELS.STEAM_CLEAR_SESSION]: { ok: boolean; message?: string };
  [IPC_CHANNELS.ACCOUNT_GIFTS_LIST]: GiftsListResult;
  [IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER]: GiftsTransferResult;
  [IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_CANCEL]: undefined;
  [IPC_CHANNELS.PROXY_TEST]: ProxyTestResult;
  [IPC_CHANNELS.PROXY_FETCH_MARKET]: {
    ok: boolean;
    proxies?: Array<Pick<ProxyEntry, 'protocol' | 'host' | 'port' | 'username' | 'password'>>;
    message?: string;
  };
  [IPC_CHANNELS.BROWSER_NAV_BACK]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_FORWARD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_RELOAD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_STOP]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_GO]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_COPY_URL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_EXPAND]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_COLLAPSE]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST]: ProxyTestResult;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EMAIL]: undefined;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: undefined;
  [IPC_CHANNELS.APP_PING_API]: NetworkStatus;
  [IPC_CHANNELS.APP_GET_VERSION]: string;
  [IPC_CHANNELS.APP_OPEN_LOGS]: undefined;
  [IPC_CHANNELS.APP_EXPORT_LOG]: { ok: boolean; path?: string };
  [IPC_CHANNELS.UPDATE_CHECK]: undefined;
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: undefined;
  [IPC_CHANNELS.UPDATE_INSTALL]: undefined;
}

export interface IpcEventMap {
  [IPC_CHANNELS.AUTH_TOKEN_RECEIVED]: AuthTokenPayload;
  [IPC_CHANNELS.AUTH_STATUS_CHANGED]: AuthStatus;
  [IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS]: LoginProgress;
  [IPC_CHANNELS.ACCOUNT_LOGIN_REQUEST]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_PROGRESS]: GiftsTransferProgress;
  [IPC_CHANNELS.ACCOUNTS_CATEGORY]: AccountsCategoryEvent;
  [IPC_CHANNELS.SETTINGS_CHANGED]: SettingsResponse;
  [IPC_CHANNELS.UPDATE_STATUS]: UpdateStatus;
  [IPC_CHANNELS.BROWSER_NAV_STATE]: BrowserNavState;
  [IPC_CHANNELS.MAIL_OPEN_REQUEST]: { emailPassword: string };
}

export type { AuthTokenPayload };
