import {
  type AccountValidity,
  type LauncherSettings,
  MAX_BOOKMARK_ICON_CHARS,
  MAX_BROWSER_BOOKMARKS,
  SERVICE_IDS,
  type ServiceId,
} from '@shared-types';

type Check = (value: unknown) => boolean;

const isBool: Check = (v) => typeof v === 'boolean';
const isString: Check = (v) => typeof v === 'string';

const nullOr =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);

/** A small non-negative whole number: every count in the settings — accounts per run, workers, minutes between refreshes. */
const isCount: Check = (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const arrayOf =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);

/** Values only: the keys are whatever JSON allowed, and every reader looks up by name. */
const recordOf =
  (check: Check): Check =>
  (v) =>
    isPlainObject(v) && Object.values(v).every(check);

const oneOf =
  (...allowed: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && allowed.includes(v);

const isServiceId: Check = (v) => SERVICE_IDS.includes(v as ServiceId);

const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);

/** A proxy as a record, not as a reachable address. */
const isProxyEntry: Check = (v) => {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== 'string' || v.id === '') return false;
  if (typeof v.host !== 'string' || v.host.trim() === '') return false;
  if (!Number.isInteger(v.port) || (v.port as number) < 1 || (v.port as number) > 65535) {
    return false;
  }
  if (!optional(isString)(v.label)) return false;
  if (!optional(isString)(v.folderId)) return false;
  if (!optional(isString)(v.username)) return false;
  if (!optional(isString)(v.password)) return false;
  if (!optional(oneOf('http', 'https'))(v.protocol)) return false;
  return optional(isPlainObject)(v.test);
};

const isProxyFolder: Check = (v) =>
  isPlainObject(v) && typeof v.id === 'string' && typeof v.name === 'string';

const VALIDITIES: readonly AccountValidity[] = ['unknown', 'valid', 'invalid'];

const isNumberArray = arrayOf((v) => typeof v === 'number' && Number.isFinite(v));

/** A price bound: a non-negative number when it is set at all. `undefined` is an entry written before the bounds existed. */
const isPrice: Check = (v) =>
  v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

const isCategoryFilters: Check = (v) => {
  if (!isPlainObject(v)) return false;
  if (!isNumberArray(v.includeLabels) || !isNumberArray(v.excludeLabels)) return false;
  if (!arrayOf(isString)(v.attrs)) return false;
  if (!arrayOf(oneOf(...VALIDITIES))(v.validity)) return false;
  if (!nullOr(isString)(v.folder)) return false;
  return nullOr(isPrice)(v.priceMin) && nullOr(isPrice)(v.priceMax);
};

/** `http:`/`https:` and nothing else — a bookmark is opened in an account's session. */
const isWebAddress: Check = (v) => {
  if (typeof v !== 'string' || v.length > 4096) return false;
  try {
    const { protocol } = new URL(v);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** A favicon inlined as an image `data:` URL — never a link the toolbar would have to fetch. */
const isIconDataUrl: Check = (v) =>
  typeof v === 'string' &&
  v.length <= MAX_BOOKMARK_ICON_CHARS &&
  /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(v);

const isBookmark: Check = (v) =>
  isPlainObject(v) &&
  typeof v.id === 'string' &&
  v.id !== '' &&
  typeof v.title === 'string' &&
  v.title.length <= 200 &&
  isWebAddress(v.url) &&
  optional(isIconDataUrl)(v.icon);

const isBookmarkList: Check = (v) =>
  arrayOf(isBookmark)(v) && (v as unknown[]).length <= MAX_BROWSER_BOOKMARKS;

const CHECKS: Record<keyof LauncherSettings, Check> = {
  telegramExePath: nullOr(isString),
  telegramMaxAccounts: isCount,
  telegramTaskConcurrency: isCount,
  telegramAvatarDir: nullOr(isString),
  locale: oneOf('ru', 'en'),
  steamInvisible: isBool,
  steamAutoLaunchGame: isBool,
  steamAutoLaunchAppId: isString,
  proxyEnabled: isBool,
  proxies: arrayOf(isProxyEntry),
  proxyFolders: arrayOf(isProxyFolder),
  proxySpreadFolders: recordOf(isString),
  proxyServices: arrayOf(isServiceId),
  knownProxyServices: arrayOf(isServiceId),
  accountProxies: recordOf(isString),
  appProxyId: nullOr(isString),
  inventoryHideInvalid: isBool,
  inventorySortKey: oneOf('purchased', 'price', 'warranty', 'title', 'checked'),
  inventorySortDir: oneOf('asc', 'desc'),
  inventoryFilters: recordOf(isCategoryFilters),
  inventoryLayout: oneOf('grid', 'table'),
  mailHistory: arrayOf(isString),
  refreshOnLaunch: isBool,
  backgroundRefreshMinutes: isCount,
  minimizeToTray: isBool,
  notifications: isBool,
  notifySystem: isBool,
  notifyOnlyWhenHidden: isBool,
  notifyCategories: recordOf(isBool),
  accountLoadConcurrency: isCount,
  metricsEnabled: nullOr(isBool),
  preferredLoginMethod: recordOf(oneOf('native', 'web')),
  localDbDir: nullOr(isString),
  localDbDirs: arrayOf(isString),
  browserBookmarks: isBookmarkList,
  browserBookmarksBar: isBool,
};

export interface SanitizedPatch {
  patch: Partial<LauncherSettings>;
  /** Key names that were dropped — never their values; see `patchedKeys`. */
  rejected: string[];
}

/** The patch, reduced to the fields that are what they claim to be. */
export const sanitizeSettingsPatch = (raw: unknown): SanitizedPatch => {
  if (!isPlainObject(raw)) return { patch: {}, rejected: [] };
  const patch: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    // `undefined` survives the type but not `JSON.stringify`.
    if (value === undefined) continue;
    const check = CHECKS[key as keyof LauncherSettings];
    if (check?.(value)) patch[key] = value;
    else rejected.push(key);
  }
  return { patch: patch as Partial<LauncherSettings>, rejected };
};
