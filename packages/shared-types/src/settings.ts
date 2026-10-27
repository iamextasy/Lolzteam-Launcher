import type { BrowserBookmark } from './browser';
import type { NotifyCategory } from './notification';
import { type LoginMethod, SERVICE_IDS, type ServiceId, getService } from './service-registry';
import type { AccountValidity } from './validity';

export type LocalePreference = 'ru' | 'en';
export type Locale = 'ru' | 'en';

/** Services whose traffic can be routed through an account proxy. */
export const PROXY_CAPABLE_SERVICES: ServiceId[] = SERVICE_IDS.filter(
  (id) => getService(id).login?.proxy === true,
);

export interface ProxyTestResult {
  ok: boolean;
  ms?: number;
  ip?: string;
  message?: string;
  checkedAt: number;
}

/** A user-made folder of proxies. */
export interface ProxyFolder {
  id: string;
  name: string;
}

export interface ProxyEntry {
  id: string;
  /** The user's own name for this proxy; falls back to `host:port` on screen. */
  label?: string;
  /** Folder this proxy sits in. */
  folderId?: string;
  /** Proxy scheme. Defaults to 'http' when absent (back-compat). */
  protocol?: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
  test?: ProxyTestResult;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Whether a string can be dialled as a proxy host. */
export const isProxyHost = (host: string): boolean => {
  const value = host.trim();
  if (!value || value.length > 253) return false;
  if (value === 'localhost') return true;
  return IPV4.test(value) || HOSTNAME.test(value);
};

export interface LauncherSettings {
  telegramExePath: string | null;
  telegramMaxAccounts: number;
  /** How many Telegram accounts a «База» run touches at once (1–5). */
  telegramTaskConcurrency: number;
  /** Folder the profile filler draws avatars from, remembered between runs. */
  telegramAvatarDir: string | null;
  locale: LocalePreference;
  /** Sign into Steam with an invisible online status. */
  steamInvisible: boolean;
  steamAutoLaunchGame: boolean;
  steamAutoLaunchAppId: string;
  proxyEnabled: boolean;
  proxies: ProxyEntry[];
  /** Folders the proxy list can be split into. */
  proxyFolders: ProxyFolder[];
  /** Folder last chosen for «раскидать по прокси», per service. */
  proxySpreadFolders?: Partial<Record<ServiceId, string>>;
  proxyServices: ServiceId[];
  /** Proxy-capable services the user has already been offered. */
  knownProxyServices?: ServiceId[];
  /** Proxies pinned to individual accounts: `itemId` → proxy id. */
  accountProxies: Record<string, string>;
  appProxyId: string | null;
  inventoryHideInvalid: boolean;
  inventorySortKey: InventorySortKey;
  inventorySortDir: InventorySortDir;
  /** The filters dialog's selections, one entry per category tab — a tab nobody has filtered has no entry at all. */
  inventoryFilters: Partial<Record<InventoryCategory, InventoryCategoryFilters>>;
  /** How the account list is drawn: cards in a grid, or a dense table. */
  inventoryLayout: InventoryLayout;
  mailHistory: string[];
  /** Refresh the account list automatically when the app starts. */
  refreshOnLaunch: boolean;
  /** Auto-refresh interval in minutes while running (0 = off). */
  backgroundRefreshMinutes: number;
  /** Hide to the system tray instead of quitting when the window is closed. */
  minimizeToTray: boolean;
  /** The notification centre as a whole — the bell in the header and the toasts both. */
  notifications: boolean;
  /** Raise an OS toast as well, and not only the in-app bell. */
  notifySystem: boolean;
  /** …and only while the window is not the one the user is looking at. */
  notifyOnlyWhenHidden: boolean;
  /** Categories switched off, by id. */
  notifyCategories: Partial<Record<NotifyCategory, boolean>>;
  /** How many account categories to load concurrently (1–4). */
  accountLoadConcurrency: number;
  /** Whether the anonymous metric may send anything. */
  metricsEnabled: boolean | null;
  /** Remembered login method per service (e.g. Steam: native client vs browser). */
  preferredLoginMethod: Partial<Record<ServiceId, LoginMethod>>;
  /** Folder holding the hand-added accounts. */
  localDbDir: string | null;
  /** Every base folder the user has opened, oldest first — the switcher's list. */
  localDbDirs: string[];
  /** Pages pinned to the bookmarks bar of the built-in browser, in bar order. */
  browserBookmarks: BrowserBookmark[];
  /** Draw the bookmarks bar under the address bar (when there is anything on it). */
  browserBookmarksBar: boolean;
}

/** What the grid is ordered by. */
export type InventorySortKey = 'purchased' | 'price' | 'warranty' | 'title' | 'checked';
export type InventorySortDir = 'asc' | 'desc';
export type InventoryLayout = 'grid' | 'table';

/** A category tab of the account list: one service, or every service at once. */
export type InventoryCategory = ServiceId | 'all';

/** What the filters dialog narrows the list with, for one category tab. */
export interface InventoryCategoryFilters {
  /** Show accounts carrying ANY of these labels… */
  includeLabels: number[];
  /** …hiding any that carry one of these. */
  excludeLabels: number[];
  /** Selected `ACCOUNT_ATTRIBUTES` ids; all of them must hold. */
  attrs: string[];
  /** Verdicts to show; empty means «any», and then `inventoryHideInvalid` decides. */
  validity: AccountValidity[];
  /** Folder of the local base, `''` for its root, `null` for all of them. */
  folder: string | null;
  /** Price window in the user's currency; `null` leaves that side open. Market scopes only. */
  priceMin: number | null;
  priceMax: number | null;
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  telegramExePath: null,
  telegramMaxAccounts: 3,
  telegramTaskConcurrency: 3,
  telegramAvatarDir: null,
  locale: 'ru',
  steamInvisible: false,
  steamAutoLaunchGame: false,
  steamAutoLaunchAppId: '',
  proxyEnabled: false,
  proxies: [],
  proxyFolders: [],
  proxySpreadFolders: {},
  proxyServices: [...PROXY_CAPABLE_SERVICES],
  knownProxyServices: [...PROXY_CAPABLE_SERVICES],
  accountProxies: {},
  appProxyId: null,
  inventoryHideInvalid: false,
  inventorySortKey: 'purchased',
  inventorySortDir: 'desc',
  inventoryFilters: {},
  inventoryLayout: 'grid',
  mailHistory: [],
  refreshOnLaunch: true,
  backgroundRefreshMinutes: 0,
  minimizeToTray: true,
  notifications: true,
  notifySystem: true,
  notifyOnlyWhenHidden: true,
  notifyCategories: {},
  accountLoadConcurrency: 2,
  metricsEnabled: null,
  preferredLoginMethod: {},
  localDbDir: null,
  localDbDirs: [],
  browserBookmarks: [],
  browserBookmarksBar: true,
};

/** May this category speak? */
export const isNotifyCategoryEnabled = (
  settings: Pick<LauncherSettings, 'notifyCategories'> | null | undefined,
  category: NotifyCategory,
): boolean => settings?.notifyCategories?.[category] !== false;

/** The three settings a pin is read through. */
export type ProxyPinSettings = Partial<
  Pick<LauncherSettings, 'proxyEnabled' | 'proxies' | 'proxyServices' | 'accountProxies'>
>;

/** The proxy this account insists on, or `null` for «whatever the run decides». */
export const pinnedProxyFor = (
  settings: ProxyPinSettings | null | undefined,
  itemId: number,
  category: ServiceId | null,
): ProxyEntry | null => {
  if (!settings?.proxyEnabled) return null;
  if (category === null || !settings.proxyServices?.includes(category)) return null;
  const id = settings.accountProxies?.[String(itemId)];
  if (!id) return null;
  return settings.proxies?.find((p) => p.id === id) ?? null;
};

export interface SettingsResponse {
  settings: LauncherSettings;
  effectiveLocale: Locale;
}

export interface PickFileOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
  /** Pick a folder instead of a file; `filters` is then ignored. */
  directory?: boolean;
}
