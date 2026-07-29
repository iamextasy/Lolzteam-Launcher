import {
  type AccountsCategoryEvent,
  type CheckAccountResult,
  type GiftsListResult,
  type GiftsTransferProgress,
  type GiftsTransferResult,
  IPC_CHANNELS,
  type LabelMutationResult,
  type LoginProgress,
  type NetworkStatus,
  type ProxyTestResult,
  type TagOpResult,
  type UpdateStatus,
} from '@shared-ipc';
import type {
  AccountDetails,
  AccountScope,
  AccountSummary,
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
} from '@shared-types';
import { contextBridge, ipcRenderer } from 'electron';

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
    listStream: (only?: ServiceId, scope?: AccountScope, streamId?: number) =>
      invoke<void>(
        IPC_CHANNELS.ACCOUNTS_LIST_STREAM,
        only || scope || streamId !== undefined ? { only, scope, streamId } : undefined,
      ),
    onCategory: (h: (p: AccountsCategoryEvent) => void) =>
      on<AccountsCategoryEvent>(IPC_CHANNELS.ACCOUNTS_CATEGORY, h),
    refresh: () => invoke<AccountSummary[]>(IPC_CHANNELS.ACCOUNTS_REFRESH),
    clearCache: () => invoke<void>(IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE),
    get: (itemId: number) => invoke<AccountDetails | null>(IPC_CHANNELS.ACCOUNTS_GET, { itemId }),
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
    cancelLogin: (itemId: number) => invoke<void>(IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL, { itemId }),
    check: (itemId: number) => invoke<CheckAccountResult>(IPC_CHANNELS.ACCOUNT_CHECK, { itemId }),
    addTag: (itemId: number, tagId: number) =>
      invoke<TagOpResult>(IPC_CHANNELS.ACCOUNT_ADD_TAG, { itemId, tagId }),
    removeTag: (itemId: number, tagId: number) =>
      invoke<TagOpResult>(IPC_CHANNELS.ACCOUNT_REMOVE_TAG, { itemId, tagId }),
    onLoginProgress: (h: (p: LoginProgress) => void) =>
      on<LoginProgress>(IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS, h),
    onLoginRequest: (h: (p: { itemId: number }) => void) =>
      on<{ itemId: number }>(IPC_CHANNELS.ACCOUNT_LOGIN_REQUEST, h),
    gifts: {
      list: (
        itemId: number,
        proxyId?: string | null,
        proxyTest?: { ip: string; ms: number } | null,
      ) =>
        invoke<GiftsListResult>(IPC_CHANNELS.ACCOUNT_GIFTS_LIST, {
          itemId,
          proxyId,
          proxyTest,
        }),
      transfer: (payload: {
        itemId: number;
        destKind: 'email' | 'invite';
        pairs: Array<{ assetId: string; recipient: string }>;
        giftNames?: Record<string, string>;
        proxyId?: string | null;
        proxyTest?: { ip: string; ms: number } | null;
      }) => invoke<GiftsTransferResult>(IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER, payload),
      cancelTransfer: (itemId: number) =>
        invoke<void>(IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_CANCEL, { itemId }),
      onTransferProgress: (h: (p: GiftsTransferProgress) => void) =>
        on<GiftsTransferProgress>(IPC_CHANNELS.ACCOUNT_GIFTS_TRANSFER_PROGRESS, h),
    },
  },
  profile: {
    getLabels: () => invoke<UserLabel[]>(IPC_CHANNELS.PROFILE_LABELS_GET),
    refreshLabels: () => invoke<UserLabel[]>(IPC_CHANNELS.PROFILE_LABELS_REFRESH),
    setCurrency: (currency: MarketCurrency) =>
      invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.PROFILE_SET_CURRENCY, { currency }),
    createLabel: (title: string, bc: string) =>
      invoke<LabelMutationResult>(IPC_CHANNELS.PROFILE_LABEL_CREATE, { title, bc }),
    updateLabel: (tagId: number, title: string, bc: string) =>
      invoke<LabelMutationResult>(IPC_CHANNELS.PROFILE_LABEL_UPDATE, { tagId, title, bc }),
    deleteLabel: (tagId: number) =>
      invoke<LabelMutationResult>(IPC_CHANNELS.PROFILE_LABEL_DELETE, { tagId }),
    reorderLabels: (tagIds: number[]) =>
      invoke<LabelMutationResult>(IPC_CHANNELS.PROFILE_LABEL_REORDER, { tagIds }),
  },
  mail: {
    getLetters: (params: MailLettersRequest) =>
      invoke<MailLettersResult>(IPC_CHANNELS.MAIL_GET_LETTERS, params),
    onOpenRequest: (h: (p: { emailPassword: string }) => void) =>
      on<{ emailPassword: string }>(IPC_CHANNELS.MAIL_OPEN_REQUEST, h),
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
    clearSession: () => invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.STEAM_CLEAR_SESSION),
  },
  proxy: {
    test: (input: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password' | 'protocol'>) =>
      invoke<ProxyTestResult>(IPC_CHANNELS.PROXY_TEST, input),
    fetchMarket: () =>
      invoke<{
        ok: boolean;
        proxies?: Array<Pick<ProxyEntry, 'protocol' | 'host' | 'port' | 'username' | 'password'>>;
        message?: string;
      }>(IPC_CHANNELS.PROXY_FETCH_MARKET),
  },
  app: {
    getVersion: () => invoke<string>(IPC_CHANNELS.APP_GET_VERSION),
    pingApi: () => invoke<NetworkStatus>(IPC_CHANNELS.APP_PING_API),
    openExternal: (url: string) => invoke<void>(IPC_CHANNELS.APP_OPEN_EXTERNAL, { url }),
    openLogs: () => invoke<void>(IPC_CHANNELS.APP_OPEN_LOGS),
    exportLog: () => invoke<{ ok: boolean; path?: string }>(IPC_CHANNELS.APP_EXPORT_LOG),
  },
  updater: {
    check: () => invoke<void>(IPC_CHANNELS.UPDATE_CHECK),
    download: () => invoke<void>(IPC_CHANNELS.UPDATE_DOWNLOAD),
    install: () => invoke<void>(IPC_CHANNELS.UPDATE_INSTALL),
    onStatus: (h: (p: UpdateStatus) => void) => on<UpdateStatus>(IPC_CHANNELS.UPDATE_STATUS, h),
  },
} as const;

export type LauncherApi = typeof api;

contextBridge.exposeInMainWorld('launcher', api);
