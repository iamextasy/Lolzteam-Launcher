import type {
  BrowserExtensionInfo,
  ExtensionErrorCode,
  ExtensionInstallPreview,
  ExtensionInstallSource,
} from '@shared-types';

/**
 * The words around an extension in the settings: what its permissions mean, which sites it reads, which error
 * to show. Pure, so the preview can be checked without a window.
 */

/** Permissions the settings can name in words; anything else is shown as Chrome spells it. */
export const NAMED_PERMISSIONS = [
  'activeTab',
  'alarms',
  'background',
  'bookmarks',
  'browsingData',
  'clipboardRead',
  'clipboardWrite',
  'contentSettings',
  'contextMenus',
  'cookies',
  'debugger',
  'declarativeNetRequest',
  'declarativeNetRequestFeedback',
  'declarativeNetRequestWithHostAccess',
  'downloads',
  'geolocation',
  'history',
  'identity',
  'idle',
  'management',
  'nativeMessaging',
  'notifications',
  'offscreen',
  'privacy',
  'proxy',
  'scripting',
  'sidePanel',
  'storage',
  'tabs',
  'topSites',
  'tts',
  'unlimitedStorage',
  'webNavigation',
  'webRequest',
  'webRequestBlocking',
] as const;

const NAMED: ReadonlySet<string> = new Set(NAMED_PERMISSIONS);

/** The i18n key that describes a permission, or `null` when it has no words of its own and is shown as is. */
export const permissionKey = (permission: string): string | null =>
  NAMED.has(permission) ? `settings.browser.extensions.perm.${permission}` : null;

export const ERROR_KEYS: Readonly<Record<ExtensionErrorCode, string>> = {
  bad_input: 'settings.browser.extensions.errors.bad_input',
  download_failed: 'settings.browser.extensions.errors.download_failed',
  not_found: 'settings.browser.extensions.errors.not_found',
  bad_package: 'settings.browser.extensions.errors.bad_package',
  bad_manifest: 'settings.browser.extensions.errors.bad_manifest',
  unsupported_manifest: 'settings.browser.extensions.errors.unsupported_manifest',
  too_large: 'settings.browser.extensions.errors.too_large',
  io: 'settings.browser.extensions.errors.io',
};

/**
 * What a failed call was doing — the same code means different things: `bad_input` is a bad link for the store
 * and an unreadable path for a file or a folder; `not_found` is a store without the extension, a preview that
 * expired before «Установить» (`commit`), or an extension already gone from the list (`manage`).
 */
export type ErrorContext = ExtensionInstallSource['kind'] | 'commit' | 'manage' | 'update';

const CONTEXT_KEYS = {
  badPath: 'settings.browser.extensions.errors.bad_input_path',
  expired: 'settings.browser.extensions.errors.expired',
  gone: 'settings.browser.extensions.errors.gone',
} as const;

/** The message for a failed call; anything that is not one of the codes (a rejected call) reads as an I/O failure. */
export const errorKey = (code: unknown, context?: ErrorContext): string => {
  if (typeof code !== 'string' || !Object.hasOwn(ERROR_KEYS, code)) return ERROR_KEYS.io;
  if (code === 'bad_input' && (context === 'file' || context === 'folder')) {
    return CONTEXT_KEYS.badPath;
  }
  if (code === 'not_found' && context === 'commit') return CONTEXT_KEYS.expired;
  if (code === 'not_found' && context === 'manage') return CONTEXT_KEYS.gone;
  return ERROR_KEYS[code as ExtensionErrorCode];
};

/** Every message key the page can show — the dictionaries must have each. */
export const ALL_ERROR_KEYS: readonly string[] = [
  ...Object.values(ERROR_KEYS),
  ...Object.values(CONTEXT_KEYS),
];

/** What an extension may read, as the preview says it: every site, a few named ones, or none at all. */
export type HostAccess =
  | { readonly kind: 'all' }
  | { readonly kind: 'some'; readonly hosts: readonly string[]; readonly more: number }
  | { readonly kind: 'none' };

/** `*://*.steamcommunity.com/tradeoffer/*` → `*.steamcommunity.com`: the scheme and the path say little to a user. */
export const patternHost = (pattern: string): string => {
  const match = /^[a-z*-]+:\/\/([^/]*)(\/.*)?$/i.exec(pattern.trim());
  return match?.[1] || pattern.trim();
};

/** A pattern any site matches: `<all_urls>`, and `*` as the host under any scheme. */
const isEverySite = (pattern: string): boolean =>
  pattern === '<all_urls>' || /^[a-z*-]+:\/\/\*\/.*$/i.test(pattern.trim());

export const hostAccess = (patterns: readonly string[], max = 6): HostAccess => {
  if (patterns.some(isEverySite)) return { kind: 'all' };
  const hosts = [...new Set(patterns.map(patternHost).filter((h) => h !== ''))];
  if (hosts.length === 0) return { kind: 'none' };
  return { kind: 'some', hosts: hosts.slice(0, max), more: Math.max(0, hosts.length - max) };
};

/**
 * A `.crx`/`.zip` or a folder can carry any id through `manifest.key`, the one a store install already has — and
 * then it inherits that extension's data. Legitimate (a developer's own build), but the user should know.
 */
export const replacesStoreInstall = (
  preview: ExtensionInstallPreview,
  installed: readonly BrowserExtensionInfo[],
): boolean =>
  preview.extension.source === 'file' &&
  installed.some((ext) => ext.id === preview.extension.id && ext.source === 'webstore');

/** `replaces` with the same version: the same files again, from the same or another source. */
export const isReinstall = (preview: ExtensionInstallPreview): boolean =>
  preview.replaces !== null && preview.replaces === preview.extension.version;
