import { createPublicKey, generateKeyPair } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { promisify } from 'node:util';
import { idFromPublicKey } from './crx';
import { fail } from './errors';
import { exists, removeDir } from './files';
import { MANIFEST_FILE, extensionPath, pageRefs, readManifestJson, splitPageRef } from './manifest';
import { API_SHIM_JS, CONTENT_SHIM_JS, GENERATED_MARK, serviceWorkerWrapper } from './shims';

/** Bump when the shims change: on the next start every installed extension is re-patched into a fresh folder. */
export const PATCH_VERSION = 2;

/** Not `__lzt`: Chromium reserves root names that start with `_` and warns about them on every load. */
export const COMPAT_DIR = 'lzt-compat';
export const SHIM_FILE = `${COMPAT_DIR}/shim.js`;
export const CONTENT_SHIM_FILE = `${COMPAT_DIR}/cs-shim.js`;
export const ORIGINAL_MANIFEST_FILE = `${COMPAT_DIR}/manifest.orig.json`;
export const PATCH_INFO_FILE = `${COMPAT_DIR}/patch.json`;
export const SHIM_TAG = `<script src="/${SHIM_FILE}"></script>`;

const WRAPPER_BASE = 'lzt-compat-sw';

/** Left by the store and by zippers; `_metadata` holds hashes of files the patch is about to change. */
const DROPPED_DIRS = ['_metadata', '__MACOSX'];

/**
 * First in the list, in every frame, before anything else: later scripts of the extension share its world. Only on
 * the sites the extension's own content scripts match — Chromium counts content-script matches as host access, so
 * `<all_urls>` here would hand every extension every site (and the accounts' cookies there), past what the install
 * preview showed.
 */
const contentShimEntry = (matches: readonly string[]) => ({
  matches,
  js: [CONTENT_SHIM_FILE],
  all_frames: true,
  match_about_blank: true,
  run_at: 'document_start',
});

/** Every pattern the content scripts match, once each, in order. */
const contentScriptMatches = (scripts: readonly unknown[]): string[] => [
  ...new Set(
    scripts.flatMap((cs) =>
      isObject(cs) && Array.isArray(cs.matches)
        ? cs.matches.filter((m): m is string => typeof m === 'string')
        : [],
    ),
  ),
];

const generateKeyPairAsync = promisify(generateKeyPair);

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const at = (dir: string, rel: string): string => join(dir, ...rel.split('/'));

export interface PatchOptions {
  /** The CRX's own key: it decides the id, and replaces any key the manifest carries. */
  readonly publicKey?: Buffer | null;
  /** The key an earlier patch of this folder wrote — see {@link restoreOriginalManifest}. */
  readonly carriedKey?: string | null;
  /** A key the launcher generated for an earlier version of the same package, reused so the id stays. */
  readonly reuseKey?: string | null;
}

export interface PatchResult {
  readonly id: string;
  /** Base64 SPKI when the launcher made the key up (now or for an earlier version); `null` for a real one. */
  readonly generatedKey: string | null;
}

/** A `manifest.key` value as DER, or `null` when it is not a public key at all. */
export const decodeKey = (value: unknown): Buffer | null => {
  if (typeof value !== 'string') return null;
  const der = Buffer.from(value.replace(/\s+/g, ''), 'base64');
  if (der.length === 0) return null;
  try {
    createPublicKey({ key: der, format: 'der', type: 'spki' });
    return der;
  } catch {
    return null;
  }
};

/**
 * The key that names the extension. A package without one would get an id from its folder path, which changes with
 * every version folder and would orphan its storage each update — so a fresh RSA key is made up instead.
 * Only the public half is kept; the private one is never written anywhere.
 */
const chooseKey = async (
  manifest: Json,
  options: PatchOptions,
): Promise<{ der: Buffer; generated: boolean }> => {
  if (options.publicKey) return { der: options.publicKey, generated: false };
  const own = decodeKey(manifest.key) ?? decodeKey(options.carriedKey);
  if (own) return { der: own, generated: false };
  const reused = decodeKey(options.reuseKey);
  if (reused) return { der: reused, generated: true };
  const { publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
  return { der: publicKey.export({ type: 'spki', format: 'der' }), generated: true };
};

/**
 * Puts the shim tag first in the document: right after `<head>`, creating the head when there is none. Idempotent.
 * Works on latin1 text, so whatever bytes the page is made of pass through unchanged.
 */
export const injectShimTag = (html: string): string => {
  if (html.includes(SHIM_TAG)) return html;
  const insert = (index: number, text: string): string =>
    `${html.slice(0, index)}${text}${html.slice(index)}`;
  const head = /<head(?=[\s>])[^>]*>/i.exec(html);
  if (head) return insert(head.index + head[0].length, SHIM_TAG);
  const wrapped = `<head>${SHIM_TAG}</head>`;
  const root = /<html(?=[\s>])[^>]*>/i.exec(html);
  if (root) return insert(root.index + root[0].length, wrapped);
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) return insert(doctype.index + doctype[0].length, wrapped);
  return `${wrapped}${html}`;
};

/** A page worth the shim on its own merits: a whole document that runs scripts. A fragment is often pulled into another document, where the tag has no business. */
const RUNS_SCRIPTS = /<script\b/i;
const WHOLE_DOCUMENT = /<(?:html|head)(?=[\s>])/i;

/**
 * Puts the shim into `file` (relative, `/`-separated) when `always` — a page the manifest names — or when the page
 * runs scripts of its own: popups open further pages (SIH's bookmarks and custom buttons) that read `storage.sync` too.
 */
const shimPage = async (dir: string, file: string, always: boolean): Promise<void> => {
  const path = at(dir, file);
  const bytes = await fs.readFile(path).catch(() => null);
  if (!bytes) return;
  // UTF-16 would be mangled by an ASCII tag; such pages go without the shim.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return;
  const html = bytes.toString('latin1');
  if (!always && !(RUNS_SCRIPTS.test(html) && WHOLE_DOCUMENT.test(html))) return;
  const patched = injectShimTag(html);
  if (patched !== html) await fs.writeFile(path, Buffer.from(patched, 'latin1'));
};

/** Every `.html` in the package but ours, `/`-separated. */
const htmlFiles = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir, { recursive: true }))
    .map((p) => p.split(sep).join('/'))
    .filter((p) => /\.html?$/i.test(p) && !p.startsWith(`${COMPAT_DIR}/`));

/** A free name for the worker wrapper beside the original — or ours from an earlier patch, which is overwritten. */
const wrapperName = async (dir: string, folder: string): Promise<string> => {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${WRAPPER_BASE}.js` : `${WRAPPER_BASE}-${n}.js`;
    const text = await fs
      .readFile(at(dir, folder === '.' ? name : `${folder}/${name}`), 'utf8')
      .catch(() => null);
    if (text === null || text.startsWith(GENERATED_MARK)) return name;
  }
};

/**
 * Undoes an earlier patch of `dir` — a launcher-installed folder picked as the source, or a re-patch for a new
 * shim version — so the patch starts from the original manifest. Returns the key the patched manifest carried,
 * which keeps the id. HTML pages keep their tag; injecting it again is a no-op.
 */
export const restoreOriginalManifest = async (dir: string): Promise<string | null> => {
  const original = await fs.readFile(at(dir, ORIGINAL_MANIFEST_FILE)).catch(() => null);
  if (!original) return null;
  const current = await readManifestJson(dir).catch(() => null);
  await fs.writeFile(join(dir, MANIFEST_FILE), original);
  return typeof current?.key === 'string' ? current.key : null;
};

/**
 * Makes the unpacked extension in `dir` (a staged copy — never the user's own folder) run on Electron 33:
 * shims in front of its content scripts, worker or background page, popup, options and every other page that runs
 * scripts; a key that fixes its id; no `update_url`. The original manifest is kept in `lzt-compat/` for the next patch. Assumes the
 * manifest passed {@link readManifest}.
 */
export const patchExtension = async (
  dir: string,
  options: PatchOptions = {},
): Promise<PatchResult> => {
  const originalText = await fs.readFile(join(dir, MANIFEST_FILE));
  // `update_url` goes: the launcher updates its extensions itself; Chrome's updater has no business here.
  const { update_url: _updateUrl, ...manifest } = await readManifestJson(dir);
  const mv = manifest.manifest_version === 2 ? 2 : 3;

  for (const name of DROPPED_DIRS) await removeDir(join(dir, name));
  await fs.mkdir(join(dir, COMPAT_DIR), { recursive: true });
  const originalPath = at(dir, ORIGINAL_MANIFEST_FILE);
  if (!(await exists(originalPath))) await fs.writeFile(originalPath, originalText);
  await fs.writeFile(at(dir, SHIM_FILE), API_SHIM_JS);
  await fs.writeFile(at(dir, CONTENT_SHIM_FILE), CONTENT_SHIM_JS);

  const key = await chooseKey(manifest, options);
  manifest.key = key.der.toString('base64');

  if (Array.isArray(manifest.content_scripts)) {
    const matches = contentScriptMatches(manifest.content_scripts);
    // None at all is a manifest Chromium refuses anyway; a shim with no matches would only add an error of ours.
    if (matches.length > 0) {
      manifest.content_scripts = [contentShimEntry(matches), ...manifest.content_scripts];
    }
  }

  const bg = manifest.background;
  if (isObject(bg)) {
    if (mv === 3 && bg.service_worker !== undefined) {
      const sw = extensionPath(bg.service_worker);
      if (!sw) fail('bad_manifest', 'background.service_worker is not a path in the package');
      const folder = posix.dirname(sw);
      const name = await wrapperName(dir, folder);
      const wrapper = folder === '.' ? name : `${folder}/${name}`;
      await fs.writeFile(
        at(dir, wrapper),
        serviceWorkerWrapper(posix.basename(sw), SHIM_FILE, bg.type === 'module'),
      );
      bg.service_worker = wrapper;
    } else if (mv === 2 && Array.isArray(bg.scripts)) {
      bg.scripts = [SHIM_FILE, ...bg.scripts.filter((s) => s !== SHIM_FILE)];
    }
  }

  const refs = pageRefs(manifest);
  const named = new Set(
    [refs.popup, refs.options, mv === 2 && isObject(bg) ? bg.page : null]
      .map((r) => splitPageRef(r)?.file)
      .filter((f): f is string => f !== undefined),
  );
  for (const file of named) await shimPage(dir, file, true);
  for (const file of await htmlFiles(dir)) if (!named.has(file)) await shimPage(dir, file, false);

  await fs.writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(
    at(dir, PATCH_INFO_FILE),
    `${JSON.stringify({ patchVersion: PATCH_VERSION }, null, 2)}\n`,
  );

  return {
    id: idFromPublicKey(key.der),
    generatedKey: key.generated ? key.der.toString('base64') : null,
  };
};
