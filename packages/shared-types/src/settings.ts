import type { ServiceId } from './service-id';

export type LocalePreference = 'ru' | 'en';
export type Locale = 'ru' | 'en';

export const PROXY_CAPABLE_SERVICES: ServiceId[] = [
  'steam',
  'telegram',
  'tiktok',
  'instagram',
  'discord',
  'llm',
];

export interface ProxyTestResult {
  ok: boolean;
  ms?: number;
  ip?: string;
  message?: string;
  checkedAt: number;
}

export interface ProxyEntry {
  id: string;
  label?: string;
  /** Proxy scheme. Defaults to 'http' when absent (back-compat). */
  protocol?: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
  test?: ProxyTestResult;
}

export interface LauncherSettings {
  telegramExePath: string | null;
  telegramMaxAccounts: number;
  locale: LocalePreference;
  /** Sign into Steam with an invisible online status. */
  steamInvisible: boolean;
  steamAutoLaunchGame: boolean;
  steamAutoLaunchAppId: string;
  proxyEnabled: boolean;
  proxies: ProxyEntry[];
  proxyServices: ServiceId[];
  appProxyId: string | null;
  inventoryHideInvalid: boolean;
  inventorySortKey: InventorySortKey;
  inventorySortDir: InventorySortDir;
  mailHistory: string[];
  /** Refresh the account list automatically when the app starts. */
  refreshOnLaunch: boolean;
  /** Auto-refresh interval in minutes while running (0 = off). */
  backgroundRefreshMinutes: number;
  /** Hide to the system tray instead of quitting when the window is closed. */
  minimizeToTray: boolean;
  /** How many account categories to load concurrently (1–4). */
  accountLoadConcurrency: number;
  /** Remembered login method per service (e.g. Steam: native client vs browser). */
  preferredLoginMethod: Partial<Record<ServiceId, 'native' | 'web'>>;
}

export type InventorySortKey = 'purchased' | 'price' | 'warranty';
export type InventorySortDir = 'asc' | 'desc';

export const DEFAULT_SETTINGS: LauncherSettings = {
  telegramExePath: null,
  telegramMaxAccounts: 3,
  locale: 'ru',
  steamInvisible: false,
  steamAutoLaunchGame: false,
  steamAutoLaunchAppId: '',
  proxyEnabled: false,
  proxies: [],
  proxyServices: [...PROXY_CAPABLE_SERVICES],
  appProxyId: null,
  inventoryHideInvalid: false,
  inventorySortKey: 'purchased',
  inventorySortDir: 'desc',
  mailHistory: [],
  refreshOnLaunch: true,
  backgroundRefreshMinutes: 0,
  minimizeToTray: true,
  accountLoadConcurrency: 2,
  preferredLoginMethod: {},
};

export interface SettingsResponse {
  settings: LauncherSettings;
  effectiveLocale: Locale;
}

export interface PickFileOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}
