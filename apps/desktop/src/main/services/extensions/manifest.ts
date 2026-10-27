import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { fail } from './errors';

export const MANIFEST_FILE = 'manifest.json';

/** What the launcher shows and needs of an extension, read off its manifest. */
export interface ManifestInfo {
  readonly manifestVersion: 2 | 3;
  /** `__MSG_…__` already resolved. */
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly permissions: string[];
  /** Host permissions plus the sites the content scripts run on — together, what the extension can read. */
  readonly hostPermissions: string[];
  /** Relative to the extension root, query kept; `null` when the manifest names none or the file is missing. */
  readonly popupPage: string | null;
  readonly optionsPage: string | null;
  /** A `data:` URL — the app's CSP refuses `file:` images. */
  readonly icon: string | null;
}

/**
 * Permissions Electron 33 cannot honour: the API is missing (or a stub the launcher adds answers with nothing),
 * so whatever the extension does with it will not work. Shown to the user before installing.
 */
export const UNSUPPORTED_PERMISSIONS: ReadonlySet<string> = new Set([
  'background',
  'bookmarks',
  'browsingData',
  'clipboardRead',
  'contentSettings',
  'contextMenus',
  'cookies',
  'debugger',
  'declarativeContent',
  'desktopCapture',
  'downloads',
  'downloads.open',
  'downloads.shelf',
  'downloads.ui',
  'favicon',
  'fontSettings',
  'gcm',
  'history',
  'identity',
  'identity.email',
  'nativeMessaging',
  'notifications',
  'offscreen',
  'pageCapture',
  'privacy',
  'proxy',
  'readingList',
  'search',
  'sessions',
  'sidePanel',
  'tabCapture',
  'tabGroups',
  'topSites',
  'tts',
  'ttsEngine',
  'userScripts',
  'webNavigation',
]);

export const unsupportedPermissions = (permissions: readonly string[]): string[] =>
  permissions.filter((p) => UNSUPPORTED_PERMISSIONS.has(p));

const ICON_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** An icon bigger than this would bloat the registry and every IPC list; the next size down is tried. */
export const MAX_ICON_BYTES = 256 * 1024;

const MAX_NAME = 120;
const MAX_DESCRIPTION = 1000;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Chrome's own rule: one to four dot-separated integers 0–65535, no leading zeros. */
export const isValidVersion = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(v) &&
  v.split('.').every((n) => Number(n) <= 65535);

/** `<0`, `0`, `>0` as `a` is older than, the same as, or newer than `b`; missing parts count as 0. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * A path the manifest names, as a `/`-separated path inside the extension — or `null` when it is a URL, climbs
 * out with `..`, or is empty. A leading `/` means the extension root, as Chrome reads it.
 */
export const extensionPath = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const path = raw.trim().replace(/^\/+/, '');
  if (!path || path.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') return null;
    if (part === '' || part === '.') continue;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
};

/** A page reference split into the file and whatever query or fragment rides on it. */
export const splitPageRef = (raw: unknown): { file: string; suffix: string } | null => {
  if (typeof raw !== 'string') return null;
  const at = raw.search(/[?#]/);
  const file = extensionPath(at < 0 ? raw : raw.slice(0, at));
  return file ? { file, suffix: at < 0 ? '' : raw.slice(at) } : null;
};

const isFile = async (path: string): Promise<boolean> =>
  fs.stat(path).then(
    (s) => s.isFile(),
    () => false,
  );

/**
 * JSON as Chrome reads `manifest.json` and `messages.json`: a byte-order mark, `//` and `/* *\/` comments and trailing
 * commas are all tolerated. Plain `JSON.parse` first; the cleanup runs only when that fails.
 */
export const parseLooseJson = (text: string): unknown => {
  const src = text.replace(/^﻿/, '');
  try {
    return JSON.parse(src);
  } catch {
    // Strip comments outside strings, then commas that close nothing.
    let out = '';
    let i = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
        out += src.slice(i, j + 1);
        i = j + 1;
      } else if (ch === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end < 0 ? src.length : end + 2;
      } else {
        out += ch;
        i++;
      }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  }
};

/** The manifest as an object, untouched; `bad_manifest` when it is missing or not JSON. */
export const readManifestJson = async (dir: string): Promise<Json> => {
  let text: string;
  try {
    text = await fs.readFile(join(dir, MANIFEST_FILE), 'utf8');
  } catch {
    return fail('bad_manifest', 'the package has no manifest.json');
  }
  let parsed: unknown;
  try {
    parsed = parseLooseJson(text);
  } catch {
    return fail('bad_manifest', 'manifest.json is not valid JSON');
  }
  if (!isObject(parsed)) fail('bad_manifest', 'manifest.json is not an object');
  return parsed;
};

/** The locale folder Chrome would use, matched without regard to case (Linux is not forgiving about it). */
const findLocaleDir = async (dir: string, locale: string): Promise<string | null> => {
  const root = join(dir, '_locales');
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const want = locale.toLowerCase().replace(/-/g, '_');
  const name = names.find((n) => n.toLowerCase().replace(/-/g, '_') === want);
  return name ? join(root, name) : null;
};

/** `messages.json` of the default locale, keys lower-cased (Chrome looks them up without regard to case). */
const loadMessages = async (dir: string, manifest: Json): Promise<Map<string, string>> => {
  const messages = new Map<string, string>();
  const locale = manifest.default_locale;
  const hasLocales = await fs.stat(join(dir, '_locales')).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (locale === undefined) {
    // Chrome refuses both halves of this mismatch at load time; better to say so before installing.
    if (hasLocales) fail('bad_manifest', '_locales is present but default_locale is not set');
    return messages;
  }
  if (typeof locale !== 'string' || !locale) fail('bad_manifest', 'default_locale is not a string');
  const localeDir = await findLocaleDir(dir, locale);
  let raw: unknown;
  try {
    if (!localeDir) throw new Error('missing');
    raw = parseLooseJson(await fs.readFile(join(localeDir, 'messages.json'), 'utf8'));
  } catch {
    return fail('bad_manifest', `no readable _locales/${locale}/messages.json`);
  }
  if (!isObject(raw)) return messages;
  for (const [key, entry] of Object.entries(raw)) {
    if (!isObject(entry) || typeof entry.message !== 'string') continue;
    let text = entry.message;
    const placeholders = isObject(entry.placeholders) ? entry.placeholders : {};
    text = text.replace(/\$([a-z0-9_@]+)\$/gi, (_m, name: string) => {
      const ph = Object.entries(placeholders).find(([k]) => k.toLowerCase() === name.toLowerCase());
      return ph && isObject(ph[1]) && typeof ph[1].content === 'string' ? ph[1].content : '';
    });
    // `$1`…`$9` are call-time substitutions, and a manifest string has none; `$$` is a dollar.
    text = text.replace(/\$(\$|[1-9])/g, (_m, c: string) => (c === '$' ? '$' : ''));
    messages.set(key.toLowerCase(), text);
  }
  messages.set('@@ui_locale', locale);
  messages.set('@@bidi_dir', 'ltr');
  return messages;
};

/** Chrome replaces an unknown key with nothing, and so does this. */
const localize = (value: unknown, messages: ReadonlyMap<string, string>): string =>
  typeof value === 'string'
    ? value.replace(
        /__MSG_([A-Za-z0-9_@]+)__/g,
        (_m, key: string) => messages.get(key.toLowerCase()) ?? '',
      )
    : '';

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : [];

const isHostPattern = (p: string): boolean => p === '<all_urls>' || p.includes('://');

/** Patterns that already mean "every site"; next to one of them the rest is noise. */
const ALL_SITES = new Set(['<all_urls>', '*://*/*']);

const hostAccess = (manifest: Json, mv: 2 | 3): string[] => {
  const hosts = [
    ...(mv === 3 ? strings(manifest.host_permissions) : []),
    ...strings(manifest.permissions).filter(isHostPattern),
  ];
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) if (isObject(cs)) hosts.push(...strings(cs.matches));
  }
  const unique = [...new Set(hosts)];
  const all = unique.filter((h) => ALL_SITES.has(h));
  return all.length ? all : unique;
};

/** The popup and options pages the manifest names, as page references. */
export const pageRefs = (manifest: Json): { popup: unknown; options: unknown } => {
  const action = [manifest.action, manifest.browser_action, manifest.page_action].find(
    (a) => isObject(a) && typeof a.default_popup === 'string' && a.default_popup.trim() !== '',
  ) as Json | undefined;
  const optionsUi = isObject(manifest.options_ui) ? manifest.options_ui.page : undefined;
  return { popup: action?.default_popup, options: optionsUi ?? manifest.options_page };
};

/** The page, query and all, when its file is really there. */
const existingPage = async (dir: string, ref: unknown): Promise<string | null> => {
  const split = splitPageRef(ref);
  if (!split || !(await isFile(join(dir, ...split.file.split('/'))))) return null;
  return `${split.file}${split.suffix}`;
};

/** Largest first; `icons` wins a tie with the toolbar icon. */
const iconCandidates = (manifest: Json): string[] => {
  const found: Array<{ size: number; path: string }> = [];
  const add = (v: unknown): void => {
    if (typeof v === 'string') found.push({ size: 0, path: v });
    else if (isObject(v)) {
      for (const [size, path] of Object.entries(v)) {
        if (typeof path === 'string') found.push({ size: Number(size) || 0, path });
      }
    }
  };
  add(manifest.icons);
  for (const a of [manifest.action, manifest.browser_action, manifest.page_action]) {
    if (isObject(a)) add(a.default_icon);
  }
  return found.sort((a, b) => b.size - a.size).map((f) => f.path);
};

const readIcon = async (dir: string, manifest: Json): Promise<string | null> => {
  for (const candidate of iconCandidates(manifest)) {
    const path = extensionPath(candidate);
    const type = path ? ICON_TYPES[extname(path).toLowerCase()] : undefined;
    if (!path || !type) continue;
    const file = join(dir, ...path.split('/'));
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size === 0 || stat.size > MAX_ICON_BYTES) continue;
    const data = await fs.readFile(file).catch(() => null);
    if (data) return `data:${type};base64,${data.toString('base64')}`;
  }
  return null;
};

/** Chrome refuses to load an extension whose background script is not in the package; say so before installing. */
const checkBackground = async (dir: string, manifest: Json, mv: 2 | 3): Promise<void> => {
  const bg = manifest.background;
  if (!isObject(bg)) return;
  const required: unknown[] =
    mv === 3
      ? bg.service_worker === undefined
        ? []
        : [bg.service_worker]
      : Array.isArray(bg.scripts)
        ? bg.scripts
        : bg.page === undefined
          ? []
          : [bg.page];
  for (const raw of required) {
    const path = extensionPath(raw);
    if (!path) fail('bad_manifest', `background names an invalid path: ${String(raw)}`);
    if (!(await isFile(join(dir, ...path.split('/'))))) {
      fail('bad_manifest', `background file ${path} is not in the package`);
    }
  }
};

/** Reads and checks `manifest.json` of the unpacked extension in `dir`, the way Chrome would before loading it. */
export const readManifest = async (dir: string): Promise<ManifestInfo> => {
  const manifest = await readManifestJson(dir);

  const mv = manifest.manifest_version;
  if (mv !== 2 && mv !== 3) {
    fail('unsupported_manifest', `manifest_version ${String(mv ?? 1)} is not supported`);
  }
  if ('app' in manifest || 'theme' in manifest) {
    fail('unsupported_manifest', 'apps and themes are not extensions');
  }

  const messages = await loadMessages(dir, manifest);
  const name = localize(manifest.name, messages).trim();
  if (!name) fail('bad_manifest', 'the extension has no name');
  if (!isValidVersion(manifest.version)) {
    fail('bad_manifest', `"${String(manifest.version)}" is not a valid version`);
  }
  await checkBackground(dir, manifest, mv);

  const refs = pageRefs(manifest);
  return {
    manifestVersion: mv,
    name: name.slice(0, MAX_NAME),
    version: manifest.version,
    description: localize(manifest.description, messages).trim().slice(0, MAX_DESCRIPTION),
    permissions: [...new Set(strings(manifest.permissions).filter((p) => !isHostPattern(p)))],
    hostPermissions: hostAccess(manifest, mv),
    popupPage: await existingPage(dir, refs.popup),
    optionsPage: await existingPage(dir, refs.options),
    icon: await readIcon(dir, manifest),
  };
};
