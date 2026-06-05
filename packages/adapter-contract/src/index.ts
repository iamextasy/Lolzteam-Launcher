import type {
  AccountDetails,
  LauncherSettings,
  ProxyEntry,
  ServiceId,
} from '@lolzteam/shared-types';

export type LoginMethod = 'native' | 'web';

export type ProbeResult = { available: true } | { available: false; reason: string };

export interface LoginResult {
  ok: boolean;
  method: LoginMethod;
  message?: string;
  launchedPid?: number;
  windowId?: number;
}

export interface AdapterLogger {
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}

export interface AppPaths {
  userData: string;
  logs: string;
  temp: string;
}

export type LoginStep =
  | 'fetching-credentials'
  | 'done'
  // steam
  | 'acquiring-token'
  | 'awaiting-email-code'
  | 'fetching-email-code'
  | 'killing-steam'
  | 'writing-vdf'
  | 'encrypting-token'
  | 'launching-steam'
  // telegram
  | 'building-tdata'
  | 'killing-telegram'
  | 'writing-tdata'
  | 'launching-telegram'
  // browser (cookie injection)
  | 'injecting-cookies'
  | 'launching-browser'
  // discord (token injection)
  | 'injecting-token';

export interface LoginProgressEvent {
  step: LoginStep;
  detail?: string;
}

export interface AdapterContext {
  log: AdapterLogger;
  paths: AppPaths;
  abortSignal: AbortSignal;
  onProgress?: (event: LoginProgressEvent) => void;
  fetchEmailCode?: (itemId: number) => Promise<string | null>;
  /** Fetches the Steam Guard mafile `shared_secret`. Cancels the item's guarantee — call only when a TOTP guard is required. */
  fetchSteamMafile?: (itemId: number) => Promise<string | null>;
  settings?: LauncherSettings;
  proxy?: ProxyEntry;
  proxyTest?: { ip: string; ms: number };
}

export interface ServiceAdapter {
  readonly id: ServiceId;
  readonly displayName: string;
  readonly platforms: readonly NodeJS.Platform[];
  readonly methods: readonly LoginMethod[];

  probe(method: LoginMethod, ctx: AdapterContext): Promise<ProbeResult>;
  login(method: LoginMethod, account: AccountDetails, ctx: AdapterContext): Promise<LoginResult>;
}
