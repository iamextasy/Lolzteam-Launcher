import type { LocalizedText } from '@adapter-contract';
import {
  type AccountConfirmKind,
  type AccountConfirmRequest,
  type AccountsCacheStatus,
  type AccountsCategoryEvent,
  type AuthTokenSubmitResult,
  type CheckAccountResult,
  IPC_CHANNELS,
  type LabelMutationResult,
  type ListingOp,
  type LoginProgress,
  type NetworkStatus,
  type NoteOpResult,
  type ProxyTestResult,
  type TagOpResult,
  type UpdateStatus,
} from '@shared-ipc';
import type {
  AccountPreview,
  AccountSummary,
  ActionDraft,
  ActionEntry,
  ApiMonitorSnapshot,
  AuthStatus,
  AuthTokenPayload,
  BrowserExtensionInfo,
  DesktopNotification,
  ExtensionInstallPreview,
  ExtensionInstallSource,
  ExtensionResult,
  GuardAuthSessionInfo,
  GuardCodeResult,
  GuardConfirmation,
  GuardConfirmationAction,
  GuardResult,
  GuardStatus,
  LauncherSettings,
  LocalAccountEdit,
  LocalAccountInput,
  LocalAccountResult,
  LocalDbEntry,
  LocalDbMoveMode,
  LocalDbSetDirResult,
  LocalDbSwitchResult,
  LocalImportCommitResult,
  LocalImportPreviewResult,
  LocalImportRequest,
  LocalLabel,
  LocalLabelResult,
  LocalServiceId,
  MailCredentials,
  MailLettersRequest,
  MailLettersResult,
  MarketCurrency,
  MarketScope,
  MetricsState,
  PickFileOptions,
  ProxyEntry,
  RevealFolderResult,
  ScreenCapture,
  ServiceId,
  SettingsResponse,
  SteamCheckRecord,
  SteamCheckRequest,
  SteamFriendsRequest,
  SteamLinkRequest,
  TelegramAvatarPack,
  TelegramCheckRequest,
  TelegramCleanupRequest,
  TelegramConvertRunResult,
  TelegramConvertScan,
  TelegramConvertTarget,
  TelegramIdentifyResult,
  TelegramPrivacyRequest,
  TelegramProfile,
  TelegramProfileRequest,
  TelegramRunStart,
  TelegramTaskEvent,
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

/** The mass-operations queue, which belongs to no one service. */
const onTaskProgress = (h: (p: TelegramTaskEvent) => void): Unsubscribe =>
  on<TelegramTaskEvent>(IPC_CHANNELS.TASK_PROGRESS, h);

const cancelTask = (runId: string): Promise<void> =>
  invoke<void>(IPC_CHANNELS.TASK_CANCEL, { runId });

const api = {
  auth: {
    openInApp: () => invoke<void>(IPC_CHANNELS.AUTH_OPEN_IN_APP),
    openBrowser: () => invoke<{ state: string }>(IPC_CHANNELS.AUTH_OPEN_BROWSER),
    logout: () => invoke<void>(IPC_CHANNELS.AUTH_LOGOUT),
    getStatus: () => invoke<AuthStatus>(IPC_CHANNELS.AUTH_GET_STATUS),
    /** Sign in with a token typed by hand. */
    submitToken: (token: string) =>
      invoke<AuthTokenSubmitResult>(IPC_CHANNELS.AUTH_SUBMIT_TOKEN, { token }),
    onTokenReceived: (h: (p: AuthTokenPayload) => void) =>
      on<AuthTokenPayload>(IPC_CHANNELS.AUTH_TOKEN_RECEIVED, h),
    onStatusChanged: (h: (p: AuthStatus) => void) =>
      on<AuthStatus>(IPC_CHANNELS.AUTH_STATUS_CHANGED, h),
  },
  accounts: {
    list: () => invoke<AccountSummary[]>(IPC_CHANNELS.ACCOUNTS_LIST),
    listStream: (only?: ServiceId, scope?: MarketScope, streamId?: number) =>
      invoke<void>(
        IPC_CHANNELS.ACCOUNTS_LIST_STREAM,
        only || scope || streamId !== undefined ? { only, scope, streamId } : undefined,
      ),
    onCategory: (h: (p: AccountsCategoryEvent) => void) =>
      on<AccountsCategoryEvent>(IPC_CHANNELS.ACCOUNTS_CATEGORY, h),
    refresh: () => invoke<AccountSummary[]>(IPC_CHANNELS.ACCOUNTS_REFRESH),
    clearCache: () => invoke<void>(IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE),
    // Whether the grid has anything to fall back on when the launch refresh is off.
    cacheStatus: () => invoke<AccountsCacheStatus>(IPC_CHANNELS.ACCOUNTS_CACHE_STATUS),
    // The public fields plus `owned`, for a deep link that must decide whether it may offer a login at all.
    preview: (itemId: number) =>
      invoke<AccountPreview | null>(IPC_CHANNELS.ACCOUNTS_GET_PREVIEW, { itemId }),
    // Two strings, picked out in main.
    mailCreds: (itemId: number) =>
      invoke<MailCredentials | null>(IPC_CHANNELS.ACCOUNTS_GET_MAIL, { itemId }),
    login: (
      itemId: number,
      method: 'native' | 'web' = 'native',
      proxyId?: string | null,
      proxyTest?: { ip: string; ms: number } | null,
    ) =>
      invoke<{ ok: boolean; message?: LocalizedText }>(IPC_CHANNELS.ACCOUNT_LOGIN, {
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
    // An empty `text` deletes the note — see `NoteOpResult`.
    setNote: (itemId: number, text: string) =>
      invoke<NoteOpResult>(IPC_CHANNELS.ACCOUNT_SET_NOTE, { itemId, text }),
    // Own-listing management: bump, reprice, ask the market's AI.
    bumpListing: (itemId: number) =>
      invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.ACCOUNT_BUMP, { itemId }),
    /** Everything else a seller does to their own lot, behind one channel. */
    listingOp: (itemId: number, op: ListingOp) =>
      invoke<{ ok: boolean; message?: LocalizedText }>(IPC_CHANNELS.ACCOUNT_LISTING_OP, {
        itemId,
        op,
      }),
    autoBuyPrice: (itemId: number) =>
      invoke<{ ok: boolean; price?: number | null; message?: LocalizedText }>(
        IPC_CHANNELS.ACCOUNT_AUTO_BUY_PRICE,
        { itemId },
      ),
    setListingPrice: (itemId: number, price: number, currency: string) =>
      invoke<{ ok: boolean; message?: LocalizedText }>(IPC_CHANNELS.ACCOUNT_SET_PRICE, {
        itemId,
        price,
        currency,
      }),
    aiListingPrice: (itemId: number) =>
      invoke<{ ok: boolean; price?: number | null; message?: string }>(
        IPC_CHANNELS.ACCOUNT_AI_PRICE,
        { itemId },
      ),
    onLoginProgress: (h: (p: LoginProgress) => void) =>
      on<LoginProgress>(IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS, h),
    onLoginRequest: (h: (p: { itemId: number }) => void) =>
      on<{ itemId: number }>(IPC_CHANNELS.ACCOUNT_LOGIN_REQUEST, h),
    // Main asks whether a guarantee-cancelling step may run; the answer goes straight back.
    onConfirmRequest: (h: (p: AccountConfirmRequest) => void) =>
      on<AccountConfirmRequest>(IPC_CHANNELS.ACCOUNT_CONFIRM_REQUEST, h),
    answerConfirm: (itemId: number, kind: AccountConfirmKind, accept: boolean) =>
      invoke<void>(IPC_CHANNELS.ACCOUNT_CONFIRM_ANSWER, { itemId, kind, accept }),
  },
  localAccounts: {
    // Secrets only ever travel renderer → main.
    create: (input: LocalAccountInput) =>
      invoke<LocalAccountResult>(IPC_CHANNELS.LOCAL_ACCOUNT_CREATE, { input }),
    // The same create with the form filled in from a bought item — main reads the credentials out of it.
    copyFromMarket: (itemId: number, mafile: 'fetch' | 'skip' = 'skip') =>
      invoke<LocalAccountResult>(IPC_CHANNELS.LOCAL_ACCOUNT_FROM_MARKET, { itemId, mafile }),
    update: (id: number, input: LocalAccountInput) =>
      invoke<LocalAccountResult>(IPC_CHANNELS.LOCAL_ACCOUNT_UPDATE, { id, input }),
    remove: (id: number) => invoke<LocalAccountResult>(IPC_CHANNELS.LOCAL_ACCOUNT_DELETE, { id }),
    form: (id: number) => invoke<LocalAccountEdit | null>(IPC_CHANNELS.LOCAL_ACCOUNT_FORM, { id }),
    // Bulk import is two-phase: the prepared records stay in main behind a token.
    importPreview: (request: LocalImportRequest) =>
      invoke<LocalImportPreviewResult>(IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_PREVIEW, request),
    importCommit: (token: string, includeMissingGuard: boolean) =>
      invoke<LocalImportCommitResult>(IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_COMMIT, {
        token,
        includeMissingGuard,
      }),
    // Works for a market account too: it has no folder of its own.
    revealFolder: (id: number, service: LocalServiceId | null) =>
      invoke<RevealFolderResult>(IPC_CHANNELS.LOCAL_ACCOUNT_REVEAL, { id, service }),
    // Moving is a folder rename in the base and nothing else — `group` is a path relative to the service root.
    move: (id: number, group: string) =>
      invoke<LocalAccountResult>(IPC_CHANNELS.LOCAL_ACCOUNT_MOVE, { id, group }),
    groups: () =>
      invoke<Record<LocalServiceId, string[]>>(IPC_CHANNELS.LOCAL_ACCOUNT_GROUPS, undefined),
    // The whole set at once: the modal shows every label with a tick.
    setLabels: (id: number, labels: number[]) =>
      invoke<LocalAccountResult>(IPC_CHANNELS.LOCAL_ACCOUNT_LABELS, { id, labels }),
  },
  localLabels: {
    list: () => invoke<LocalLabel[]>(IPC_CHANNELS.LOCAL_LABEL_LIST, undefined),
    save: (id: number | null, title: string, bc: string) =>
      invoke<LocalLabelResult>(IPC_CHANNELS.LOCAL_LABEL_SAVE, { id, title, bc }),
    remove: (id: number) => invoke<LocalLabelResult>(IPC_CHANNELS.LOCAL_LABEL_DELETE, { id }),
  },
  localDb: {
    pickDir: () => invoke<string | null>(IPC_CHANNELS.LOCAL_DB_PICK_DIR),
    // Two different things on purpose: `setDir` takes the files along to another folder.
    setDir: (dir: string | null, mode: LocalDbMoveMode) =>
      invoke<LocalDbSetDirResult>(IPC_CHANNELS.LOCAL_DB_SET_DIR, { dir, mode }),
    list: () => invoke<LocalDbEntry[]>(IPC_CHANNELS.LOCAL_DB_LIST, undefined),
    switchTo: (dir: string | null) =>
      invoke<LocalDbSwitchResult>(IPC_CHANNELS.LOCAL_DB_SWITCH, { dir }),
    forget: (dir: string) => invoke<LocalDbEntry[]>(IPC_CHANNELS.LOCAL_DB_FORGET, { dir }),
    reveal: (dir: string | null) =>
      invoke<RevealFolderResult>(IPC_CHANNELS.LOCAL_DB_REVEAL, { dir }),
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
  /** The built-in browser's Chrome extensions: installing is two calls, so the user sees what they agree to. */
  extensions: {
    list: () => invoke<BrowserExtensionInfo[]>(IPC_CHANNELS.EXTENSIONS_LIST),
    // Downloads or reads the package and unpacks it aside; nothing is installed until `commit`.
    prepare: (source: ExtensionInstallSource) =>
      invoke<ExtensionResult<ExtensionInstallPreview>>(IPC_CHANNELS.EXTENSIONS_PREPARE, source),
    commit: (stagingId: string) =>
      invoke<ExtensionResult<BrowserExtensionInfo>>(IPC_CHANNELS.EXTENSIONS_COMMIT, stagingId),
    discard: (stagingId: string) => invoke<void>(IPC_CHANNELS.EXTENSIONS_DISCARD, stagingId),
    remove: (id: string) => invoke<ExtensionResult<null>>(IPC_CHANNELS.EXTENSIONS_REMOVE, id),
    setEnabled: (id: string, enabled: boolean) =>
      invoke<ExtensionResult<BrowserExtensionInfo>>(IPC_CHANNELS.EXTENSIONS_SET_ENABLED, {
        id,
        enabled,
      }),
    // Store installs only. Stages the newer version like `prepare` — `commit` installs it — or `value: null` when
    // the installed version is already the newest.
    update: (id: string) =>
      invoke<ExtensionResult<ExtensionInstallPreview | null>>(IPC_CHANNELS.EXTENSIONS_UPDATE, id),
    // The whole list, enabled or not, after every install, update, removal and toggle.
    onChanged: (h: (list: BrowserExtensionInfo[]) => void) =>
      on<BrowserExtensionInfo[]>(IPC_CHANNELS.EXTENSIONS_CHANGED, h),
  },
  steam: {
    clearSession: () => invoke<{ ok: boolean; message?: string }>(IPC_CHANNELS.STEAM_CLEAR_SESSION),
    // Ids and proxy ids out, verdicts back through the task channel.
    check: (req: SteamCheckRequest) => invoke<TelegramRunStart>(IPC_CHANNELS.STEAM_CHECK, req),
    // What the last check wrote down, so the list can show a verdict on start-up.
    checks: () => invoke<SteamCheckRecord[]>(IPC_CHANNELS.STEAM_CHECKS),
    // Ids, which relationships to drop and whether to block.
    friends: (req: SteamFriendsRequest) =>
      invoke<TelegramRunStart>(IPC_CHANNELS.STEAM_FRIENDS, req),
    // Attaching the authenticator to a whole selection.
    link: (req: SteamLinkRequest) => invoke<TelegramRunStart>(IPC_CHANNELS.STEAM_LINK, req),
  },
  steamGuard: {
    status: (accountId: number) =>
      invoke<GuardStatus>(IPC_CHANNELS.STEAM_GUARD_STATUS, { accountId }),
    link: (accountId: number, options?: { proxyId?: string | null; emailCode?: string }) =>
      invoke<GuardResult<{ status: GuardStatus }>>(IPC_CHANNELS.STEAM_GUARD_LINK, {
        accountId,
        proxyId: options?.proxyId ?? null,
        emailCode: options?.emailCode,
      }),
    unlink: (accountId: number) =>
      invoke<{ ok: boolean }>(IPC_CHANNELS.STEAM_GUARD_UNLINK, { accountId }),
    code: (accountId: number) =>
      invoke<GuardResult<{ code: GuardCodeResult }>>(IPC_CHANNELS.STEAM_GUARD_CODE, { accountId }),
    sessionInfo: (accountId: number, url: string) =>
      invoke<GuardResult<{ info: GuardAuthSessionInfo }>>(IPC_CHANNELS.STEAM_GUARD_SESSION_INFO, {
        accountId,
        url,
      }),
    approve: (accountId: number, url: string, approve: boolean) =>
      invoke<GuardResult<{ approved: boolean }>>(IPC_CHANNELS.STEAM_GUARD_APPROVE, {
        accountId,
        url,
        approve,
      }),
    screens: () => invoke<ScreenCapture[]>(IPC_CHANNELS.STEAM_GUARD_SCREENS, undefined),
    confirmations: (accountId: number) =>
      invoke<GuardResult<{ confirmations: GuardConfirmation[] }>>(
        IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS,
        { accountId },
      ),
    confirmationsAct: (
      accountId: number,
      action: GuardConfirmationAction,
      items: GuardConfirmation[],
    ) =>
      invoke<GuardResult<{ acted: number }>>(IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS_ACT, {
        accountId,
        action,
        items,
      }),
  },
  telegram: {
    /** The system-wide client the launcher would use when no path is configured (Linux only; null elsewhere). */
    detectBinary: () => invoke<{ path: string | null }>(IPC_CHANNELS.TELEGRAM_DETECT_BINARY),
    pickDir: (title?: string) =>
      invoke<{ dir: string | null }>(IPC_CHANNELS.TELEGRAM_CONVERT_PICK_DIR, { title }),
    pickPath: (mode: 'file' | 'dir', title?: string) =>
      invoke<{ path: string | null }>(IPC_CHANNELS.TELEGRAM_PICK_PATH, { mode, title }),
    // Only the facts come back; the key stays in main behind `identified.token`.
    identify: (source: { text?: string; path?: string }) =>
      invoke<TelegramIdentifyResult>(IPC_CHANNELS.TELEGRAM_IDENTIFY, source),
    convertScan: (dir: string) =>
      invoke<TelegramConvertScan>(IPC_CHANNELS.TELEGRAM_CONVERT_SCAN, { dir }),
    convertRun: (params: {
      dir: string;
      ids: string[];
      target: TelegramConvertTarget;
      outDir: string;
      withJson: boolean;
    }) => invoke<TelegramConvertRunResult>(IPC_CHANNELS.TELEGRAM_CONVERT_RUN, params),
    // Only ids and switches go out; statuses come back.
    check: (req: TelegramCheckRequest) =>
      invoke<TelegramRunStart>(IPC_CHANNELS.TELEGRAM_CHECK, req),
    // The folder is described, never listed: counts, not a hundred file names.
    avatarPack: (dir: string) =>
      invoke<TelegramAvatarPack>(IPC_CHANNELS.TELEGRAM_AVATAR_PACK, { dir }),
    fillProfiles: (req: TelegramProfileRequest) =>
      invoke<TelegramRunStart>(IPC_CHANNELS.TELEGRAM_PROFILE_FILL, req),
    // Which dialog kinds to clear goes out; how many were cleared comes back.
    cleanup: (req: TelegramCleanupRequest) =>
      invoke<TelegramRunStart>(IPC_CHANNELS.TELEGRAM_CLEANUP, req),
    privacy: (req: TelegramPrivacyRequest) =>
      invoke<TelegramRunStart>(IPC_CHANNELS.TELEGRAM_PRIVACY, req),
    // What the last check learned, kept in the database folder between runs.
    profiles: () => invoke<TelegramProfile[]>(IPC_CHANNELS.TELEGRAM_PROFILES),
    avatar: (accountId: number) =>
      invoke<string | null>(IPC_CHANNELS.TELEGRAM_AVATAR, { accountId }),
  },
  /** The queue as it really is: shared by every service that runs a batch. */
  tasks: {
    onProgress: onTaskProgress,
    cancel: cancelTask,
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
    /**
     * The OS this build runs on. The renderer has no `process`, but several
     * screens describe things that genuinely differ per platform — where a
     * Telegram session is written, what a file picker should filter on.
     */
    platform: process.platform,
    getVersion: () => invoke<string>(IPC_CHANNELS.APP_GET_VERSION),
    pingApi: () => invoke<NetworkStatus>(IPC_CHANNELS.APP_PING_API),
    // The live market-call journal; poll while the page is open.
    apiStats: () => invoke<ApiMonitorSnapshot>(IPC_CHANNELS.APP_API_STATS),
    openExternal: (url: string) => invoke<void>(IPC_CHANNELS.APP_OPEN_EXTERNAL, { url }),
    openLogs: () => invoke<void>(IPC_CHANNELS.APP_OPEN_LOGS),
    exportLog: () => invoke<{ ok: boolean; path?: string }>(IPC_CHANNELS.APP_EXPORT_LOG),
  },
  notify: {
    /** Raise an OS toast. */
    show: (notification: DesktopNotification) =>
      invoke<void>(IPC_CHANNELS.NOTIFY_SHOW, notification),
  },
  updater: {
    check: () => invoke<void>(IPC_CHANNELS.UPDATE_CHECK),
    download: () => invoke<void>(IPC_CHANNELS.UPDATE_DOWNLOAD),
    install: () => invoke<void>(IPC_CHANNELS.UPDATE_INSTALL),
    onStatus: (h: (p: UpdateStatus) => void) => on<UpdateStatus>(IPC_CHANNELS.UPDATE_STATUS, h),
  },
  /** The journal: what the app did, how it went and how long it took. */
  actionLog: {
    list: () => invoke<ActionEntry[]>(IPC_CHANNELS.ACTION_LOG_LIST),
    record: (draft: ActionDraft) => invoke<void>(IPC_CHANNELS.ACTION_LOG_RECORD, draft),
    clear: () => invoke<void>(IPC_CHANNELS.ACTION_LOG_CLEAR),
    export: () => invoke<{ ok: boolean; path?: string }>(IPC_CHANNELS.ACTION_LOG_EXPORT),
    /** One finished action, pushed as it lands, so an open viewer stays live. */
    onEntry: (h: (entry: ActionEntry) => void) => on<ActionEntry>(IPC_CHANNELS.ACTION_LOG_ENTRY, h),
  },
  /** The anonymous metric, as seen from the window: read it, answer the question, forget who I am, show me what goes out. */
  metrics: {
    state: () => invoke<MetricsState>(IPC_CHANNELS.METRICS_STATE),
    setEnabled: (enabled: boolean) =>
      invoke<MetricsState>(IPC_CHANNELS.METRICS_SET_ENABLED, enabled),
    resetId: () => invoke<MetricsState>(IPC_CHANNELS.METRICS_RESET_ID),
    /** The next request's body verbatim — the claim is checkable, not just stated. */
    preview: () => invoke<string>(IPC_CHANNELS.METRICS_PREVIEW),
  },
} as const;

export type LauncherApi = typeof api;

contextBridge.exposeInMainWorld('launcher', api);
