import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readManifest, unsupportedPermissions } from '../manifest';
import {
  CONTENT_SHIM_FILE,
  ORIGINAL_MANIFEST_FILE,
  PATCH_INFO_FILE,
  PATCH_VERSION,
  SHIM_FILE,
  SHIM_TAG,
  decodeKey,
  injectShimTag,
  patchExtension,
  restoreOriginalManifest,
} from '../patch';
import { API_SHIM_JS, CONTENT_SHIM_JS, GENERATED_MARK } from '../shims';
import { FAKE_PNG, idOf, makeRsaKey, readJson, writeTree } from './helpers';

const scratch = mkdtempSync(join(tmpdir(), 'lzt-patch-'));
afterAll(() => fs.rm(scratch, { recursive: true, force: true }));

let n = 0;
const ext = async (
  manifest: Record<string, unknown>,
  files: Record<string, string | Buffer> = {},
): Promise<string> => {
  const dir = join(scratch, `ext-${++n}`);
  await writeTree(dir, { 'manifest.json': JSON.stringify(manifest, null, 2), ...files });
  return dir;
};

const read = (dir: string, rel: string): Promise<string> =>
  fs.readFile(join(dir, ...rel.split('/')), 'utf8');

const base = { manifest_version: 3, name: 'Synthetic', version: '1.0' };

describe('injectShimTag', () => {
  it('goes right after <head>, attributes and all, and only once', () => {
    const html =
      '<!DOCTYPE html><html lang="en"><HEAD data-x="1"><meta charset="utf-8"></HEAD></html>';
    const once = injectShimTag(html);
    expect(once).toBe(
      `<!DOCTYPE html><html lang="en"><HEAD data-x="1">${SHIM_TAG}<meta charset="utf-8"></HEAD></html>`,
    );
    expect(injectShimTag(once)).toBe(once);
  });

  it('creates the head when there is none, wherever the document starts', () => {
    expect(injectShimTag('<html><body>x</body></html>')).toBe(
      `<html><head>${SHIM_TAG}</head><body>x</body></html>`,
    );
    expect(injectShimTag('<!doctype html><body>x</body>')).toBe(
      `<!doctype html><head>${SHIM_TAG}</head><body>x</body>`,
    );
    expect(injectShimTag('<div>bare</div>')).toBe(`<head>${SHIM_TAG}</head><div>bare</div>`);
  });

  it('is not fooled by <header> or <html-ish> tags', () => {
    expect(injectShimTag('<html><body><header>h</header></body></html>')).toBe(
      `<html><head>${SHIM_TAG}</head><body><header>h</header></body></html>`,
    );
  });
});

describe('patchExtension — MV3 service worker', () => {
  it('points the manifest at a classic wrapper beside the original, which stays untouched', async () => {
    const dir = await ext(
      { ...base, background: { service_worker: 'service-worker.js' } },
      { 'service-worker.js': "importScripts('bundle/a.js');" },
    );
    await patchExtension(dir);
    const manifest = await readJson(join(dir, 'manifest.json'));
    expect(manifest.background).toEqual({ service_worker: 'lzt-compat-sw.js' });
    expect(await read(dir, 'lzt-compat-sw.js')).toBe(
      `${GENERATED_MARK}\nimportScripts("/${SHIM_FILE}");\nimportScripts("./service-worker.js");\n`,
    );
    expect(await read(dir, 'service-worker.js')).toBe("importScripts('bundle/a.js');");
    expect(await read(dir, SHIM_FILE)).toBe(API_SHIM_JS);
  });

  it('keeps the wrapper in a nested worker’s own folder, so its relative imports still resolve', async () => {
    const dir = await ext(
      { ...base, background: { service_worker: '/js/bg/worker.js' } },
      { 'js/bg/worker.js': '' },
    );
    await patchExtension(dir);
    const manifest = await readJson(join(dir, 'manifest.json'));
    expect(manifest.background).toEqual({ service_worker: 'js/bg/lzt-compat-sw.js' });
    expect(await read(dir, 'js/bg/lzt-compat-sw.js')).toContain('importScripts("./worker.js");');
  });

  it('writes a module wrapper for a module worker: shim imported first', async () => {
    const dir = await ext(
      { ...base, background: { service_worker: 'sw.mjs', type: 'module' } },
      { 'sw.mjs': 'export {};' },
    );
    await patchExtension(dir);
    const manifest = await readJson(join(dir, 'manifest.json'));
    expect(manifest.background).toEqual({ service_worker: 'lzt-compat-sw.js', type: 'module' });
    expect(await read(dir, 'lzt-compat-sw.js')).toBe(
      `${GENERATED_MARK}\nimport "/${SHIM_FILE}";\nimport "./sw.mjs";\n`,
    );
  });

  it('does not overwrite an extension file that happens to have the wrapper’s name', async () => {
    const dir = await ext(
      { ...base, background: { service_worker: 'sw.js' } },
      { 'sw.js': '', 'lzt-compat-sw.js': '// the extension’s own file' },
    );
    await patchExtension(dir);
    expect((await readJson(join(dir, 'manifest.json'))).background).toEqual({
      service_worker: 'lzt-compat-sw-2.js',
    });
    expect(await read(dir, 'lzt-compat-sw.js')).toBe('// the extension’s own file');
  });
});

describe('patchExtension — MV2 background', () => {
  it('puts the shim first among background scripts', async () => {
    const dir = await ext(
      {
        ...base,
        manifest_version: 2,
        background: { scripts: ['a.js', 'b.js'], persistent: false },
      },
      { 'a.js': '', 'b.js': '' },
    );
    await patchExtension(dir);
    expect((await readJson(join(dir, 'manifest.json'))).background).toEqual({
      scripts: [SHIM_FILE, 'a.js', 'b.js'],
      persistent: false,
    });
  });

  it('injects the shim into a background page', async () => {
    const dir = await ext(
      { ...base, manifest_version: 2, background: { page: 'bg.html' } },
      { 'bg.html': '<html><head><script src="bg.js"></script></head></html>' },
    );
    await patchExtension(dir);
    expect(await read(dir, 'bg.html')).toBe(
      `<html><head>${SHIM_TAG}<script src="bg.js"></script></head></html>`,
    );
  });
});

describe('patchExtension — content scripts and pages', () => {
  it('puts the storage shim first, in every frame of the sites its scripts match, at document_start', async () => {
    const original = [
      { matches: ['https://example.test/*'], js: ['cs.js'], run_at: 'document_end' },
      {
        matches: ['https://other.example.test/a/*', 'https://example.test/*'],
        css: ['cs.css'],
        all_frames: true,
      },
    ];
    const dir = await ext({ ...base, content_scripts: original }, { 'cs.js': '', 'cs.css': '' });
    await patchExtension(dir);
    const manifest = await readJson(join(dir, 'manifest.json'));
    expect(manifest.content_scripts).toEqual([
      {
        // Not `<all_urls>`: content-script matches are host access, and the preview listed only these.
        matches: ['https://example.test/*', 'https://other.example.test/a/*'],
        js: [CONTENT_SHIM_FILE],
        all_frames: true,
        match_about_blank: true,
        run_at: 'document_start',
      },
      ...original,
    ]);
    expect(await read(dir, CONTENT_SHIM_FILE)).toBe(CONTENT_SHIM_JS);
  });

  it('gives the extension no site the install preview did not show', async () => {
    const manifest = {
      ...base,
      host_permissions: ['https://api.example.test/*'],
      content_scripts: [{ matches: ['https://example.test/trade/*'], js: ['cs.js'] }],
    };
    const dir = await ext(manifest, { 'cs.js': '' });
    const before = (await readManifest(dir)).hostPermissions;
    await patchExtension(dir);
    expect((await readManifest(dir)).hostPermissions).toEqual(before);
    expect(before).toEqual(['https://api.example.test/*', 'https://example.test/trade/*']);
  });

  it('adds no content script to an extension that has none', async () => {
    const dir = await ext(base);
    await patchExtension(dir);
    expect((await readJson(join(dir, 'manifest.json'))).content_scripts).toBeUndefined();
  });

  it('injects the page shim into the popup and options pages, once each', async () => {
    const page = '<!doctype html><html><head><title>t</title></head><body></body></html>';
    const dir = await ext(
      {
        ...base,
        action: { default_popup: 'popup.html?mode=1' },
        options_ui: { page: 'popup.html' },
      },
      { 'popup.html': page },
    );
    await patchExtension(dir);
    expect(await read(dir, 'popup.html')).toBe(page.replace('<head>', `<head>${SHIM_TAG}`));
  });

  it('shims every other page that runs scripts, and leaves fragments alone', async () => {
    const page =
      '<!doctype html><html><head></head><body><script src="/js/page.js"></script></body></html>';
    const fragment = '<div class="changelog"><p>v1</p></div>';
    const staticDoc = '<html><head><title>about</title></head><body>no scripts</body></html>';
    const dir = await ext(base, {
      'html/bookmarks.html': page,
      'deep/er/settings.HTM': page,
      'latest/en.html': fragment,
      'html/about.html': staticDoc,
    });
    await patchExtension(dir);
    expect(await read(dir, 'html/bookmarks.html')).toBe(
      page.replace('<head>', `<head>${SHIM_TAG}`),
    );
    expect(await read(dir, 'deep/er/settings.HTM')).toContain(SHIM_TAG);
    expect(await read(dir, 'latest/en.html')).toBe(fragment);
    expect(await read(dir, 'html/about.html')).toBe(staticDoc);
  });

  it('passes bytes that are not UTF-8 through unchanged, and leaves UTF-16 pages alone', async () => {
    const latin = Buffer.concat([
      Buffer.from('<html><head></head><body>'),
      Buffer.from([0xe9, 0xff, 0x00]),
      Buffer.from('</body></html>'),
    ]);
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<html><head>', 'utf16le'),
    ]);
    const dir = await ext(
      { ...base, action: { default_popup: 'a.html' }, options_page: 'b.html' },
      { 'a.html': latin, 'b.html': utf16 },
    );
    await patchExtension(dir);
    const a = await fs.readFile(join(dir, 'a.html'));
    expect(a.equals(Buffer.from(injectShimTag(latin.toString('latin1')), 'latin1'))).toBe(true);
    expect((await fs.readFile(join(dir, 'b.html'))).equals(utf16)).toBe(true);
  });
});

describe('patchExtension — key and id', () => {
  it('writes the CRX key, so the id is the store id', async () => {
    const key = makeRsaKey();
    const dir = await ext({ ...base, key: 'c29tZXRoaW5nIGVsc2U=' });
    const result = await patchExtension(dir, { publicKey: key.publicDer });
    expect(result).toEqual({ id: idOf(key.publicDer), generatedKey: null });
    expect((await readJson(join(dir, 'manifest.json'))).key).toBe(key.publicDer.toString('base64'));
  });

  it('keeps a valid key the manifest already has, normalised', async () => {
    const key = makeRsaKey();
    const b64 = key.publicDer.toString('base64');
    const wrapped = b64.replace(/(.{64})/g, '$1\n');
    const dir = await ext({ ...base, key: wrapped });
    expect(await patchExtension(dir)).toEqual({ id: idOf(key.publicDer), generatedKey: null });
    expect((await readJson(join(dir, 'manifest.json'))).key).toBe(b64);
  });

  it('makes up a key for a keyless package, and reuses one when told to', async () => {
    const first = await patchExtension(await ext(base));
    expect(first.generatedKey).not.toBeNull();
    const der = decodeKey(first.generatedKey);
    expect(der).not.toBeNull();
    expect(first.id).toBe(idOf(der!));

    const again = await patchExtension(await ext({ ...base, version: '2.0' }), {
      reuseKey: first.generatedKey,
    });
    expect(again).toEqual(first);

    const garbage = await patchExtension(await ext({ ...base, key: 'not a key' }));
    expect(garbage.generatedKey).not.toBeNull();
    expect(garbage.id).not.toBe(first.id);
  });

  it('never leaves a private key in the package', async () => {
    const dir = await ext(base);
    await patchExtension(dir);
    const all = await fs.readdir(dir, { recursive: true });
    for (const name of all) {
      const path = join(dir, String(name));
      if ((await fs.stat(path)).isFile()) {
        expect(await fs.readFile(path, 'utf8')).not.toMatch(/PRIVATE KEY/);
      }
    }
  });
});

describe('patchExtension — housekeeping', () => {
  it('drops update_url and the store’s _metadata, keeps the original manifest, records the patch version', async () => {
    const original = { ...base, update_url: 'https://clients2.google.com/service/update2/crx' };
    const dir = await ext(original, { '_metadata/verified_contents.json': '[]' });
    const before = await read(dir, 'manifest.json');
    await patchExtension(dir);
    expect((await readJson(join(dir, 'manifest.json'))).update_url).toBeUndefined();
    await expect(fs.access(join(dir, '_metadata'))).rejects.toThrow();
    expect(await read(dir, ORIGINAL_MANIFEST_FILE)).toBe(before);
    expect(await readJson(join(dir, PATCH_INFO_FILE))).toEqual({ patchVersion: PATCH_VERSION });
  });

  it('patches a patched folder from its original again, without stacking shims, keeping the id', async () => {
    const dir = await ext(
      {
        ...base,
        background: { service_worker: 'sw.js' },
        content_scripts: [{ matches: ['https://example.test/*'], js: ['cs.js'] }],
        action: { default_popup: 'popup.html' },
      },
      { 'sw.js': '', 'cs.js': '', 'popup.html': '<html><head></head></html>' },
    );
    const first = await patchExtension(dir);
    const patchedOnce = await read(dir, 'manifest.json');

    const carriedKey = await restoreOriginalManifest(dir);
    expect(carriedKey).toBe((JSON.parse(patchedOnce) as { key: string }).key);
    const second = await patchExtension(dir, { carriedKey });

    expect(second.id).toBe(first.id);
    expect(await read(dir, 'manifest.json')).toBe(patchedOnce);
    expect(await read(dir, 'popup.html')).toBe(`<html><head>${SHIM_TAG}</head></html>`);
  });

  it('restoreOriginalManifest is a no-op on a folder never patched', async () => {
    const dir = await ext(base);
    expect(await restoreOriginalManifest(dir)).toBeNull();
    expect(await readJson(join(dir, 'manifest.json'))).toEqual(base);
  });
});

/**
 * Shaped like Steam Inventory Helper 2.12.1 (the extension this work is for), with synthetic names and values:
 * MV3, a classic worker that `importScripts` relative paths, dozens of document_end content scripts, a
 * localised description, popup and options pages in sub-folders, `update_url` first, the store's `_metadata`.
 */
describe('a synthetic manifest shaped like SIH', () => {
  const contentScripts = [
    {
      js: ['js/jquery/jquery.min.js', 'js/tradeoffer.js', 'js/common/settings.js'],
      css: ['css/fontello.css'],
      matches: ['*://community.example.test/tradeoffer/*', '*://community.example.test/trade/*'],
      run_at: 'document_end',
    },
    {
      js: ['js/jquery/jquery.min.js', 'js/inventprice.js'],
      matches: [
        '*://community.example.test/id/*/inventory',
        '*://community.example.test/profiles/*/inventory/*',
      ],
      run_at: 'document_end',
    },
    {
      js: ['js/jquery/jquery.min.js', 'js/global.js'],
      css: [],
      matches: ['*://*.store.example.test/*', '*://community.example.test/*'],
      run_at: 'document_start',
    },
    {
      js: ['bundle/js/common.js', 'bundle/js/marketHandler.js'],
      matches: ['*://market.example.test/*'],
      exclude_matches: ['*://market.example.test/checkout/*'],
      run_at: 'document_start',
    },
  ];
  const manifest = {
    update_url: 'https://clients2.google.com/service/update2/crx',
    manifest_version: 3,
    name: 'Synthetic Inventory Helper',
    short_name: 'SYN',
    description: '__MSG_extension_description__',
    default_locale: 'en',
    version: '2.12.1',
    incognito: 'split',
    background: { service_worker: 'service-worker.js' },
    content_scripts: contentScripts,
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
    icons: { '128': 'assets/icon128.png' },
    action: {
      default_title: 'Synthetic Inventory Helper',
      default_icon: { '16': 'assets/icon128.png' },
      default_popup: 'html/tradeoffers.html',
    },
    options_ui: { page: 'dist/index.html', open_in_tab: true },
    permissions: [
      'notifications',
      'alarms',
      'storage',
      'unlimitedStorage',
      'background',
      'webRequest',
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
      'cookies',
      'activeTab',
      'management',
    ],
    host_permissions: ['<all_urls>'],
    declarative_net_request: {
      rule_resources: [{ id: 'ruleset_1', enabled: true, path: 'rules.json' }],
    },
    externally_connectable: { matches: ['https://community.example.test/*'] },
    web_accessible_resources: [
      { resources: ['js/*.js', 'assets/*'], matches: ['<all_urls>'], extension_ids: [] },
    ],
    homepage_url: 'https://example.test/synthetic-helper',
  };
  const worker = [
    "self.addEventListener('install', function (event) {});",
    "self.addEventListener('fetch', function (event) {});",
    'try {',
    "  importScripts('bundle/js/common.js', 'bundle/js/background.js', 'bundleAngular/backgroundAngular.js');",
    '} catch (e) {',
    '  console.error(e);',
    '}',
  ].join('\n');
  const files = {
    'service-worker.js': worker,
    'bundle/js/common.js': '',
    'bundle/js/background.js': 'chrome.windows.onBoundsChanged.addListener(function () {});',
    'bundleAngular/backgroundAngular.js': '',
    'html/tradeoffers.html':
      '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<script src="../js/popup.js"></script>\n</head>\n<body></body>\n</html>\n',
    'dist/index.html':
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="/dist/"><script src="main.js" type="module"></script></head><body><app-root></app-root></body></html>',
    '_locales/en/messages.json': JSON.stringify({
      extension_description: { message: 'Synthetic helper for a synthetic inventory.' },
    }),
    '_locales/ru/messages.json': JSON.stringify({
      extension_description: { message: 'Синтетический помощник.' },
    }),
    'html/bookmarks.html':
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script src="/js/pages/bookmarks.js"></script></body></html>',
    'latestchanges/en.html': '<h3>2.12.1</h3><ul><li>Fixes</li></ul>',
    '_metadata/computed_hashes.json': '{}',
    'assets/icon128.png': FAKE_PNG,
    'rules.json': '[]',
  };

  it('reads as the preview should show it', async () => {
    const dir = await ext(manifest, files);
    const info = await readManifest(dir);
    expect(info).toMatchObject({
      manifestVersion: 3,
      name: 'Synthetic Inventory Helper',
      version: '2.12.1',
      description: 'Synthetic helper for a synthetic inventory.',
      hostPermissions: ['<all_urls>'],
      popupPage: 'html/tradeoffers.html',
      optionsPage: 'dist/index.html',
    });
    expect(info.icon).toMatch(/^data:image\/png;base64,/);
    expect(unsupportedPermissions(info.permissions)).toEqual([
      'notifications',
      'background',
      'cookies',
    ]);
  });

  it('patches into something Electron 33 can run', async () => {
    const dir = await ext(manifest, files);
    const key = makeRsaKey();
    const result = await patchExtension(dir, { publicKey: key.publicDer });
    expect(result.id).toBe(idOf(key.publicDer));

    const patched = await readJson(join(dir, 'manifest.json'));
    const { update_url: _gone, ...unchanged } = manifest;
    expect(patched).toEqual({
      ...unchanged,
      key: key.publicDer.toString('base64'),
      background: { service_worker: 'lzt-compat-sw.js' },
      content_scripts: [
        {
          matches: [...new Set(contentScripts.flatMap((cs) => cs.matches))],
          js: [CONTENT_SHIM_FILE],
          all_frames: true,
          match_about_blank: true,
          run_at: 'document_start',
        },
        ...contentScripts,
      ],
    });

    // At the root, beside the original: `importScripts('bundle/js/…')` inside it resolves as before.
    expect(await read(dir, 'lzt-compat-sw.js')).toBe(
      `${GENERATED_MARK}\nimportScripts("/${SHIM_FILE}");\nimportScripts("./service-worker.js");\n`,
    );
    expect(await read(dir, 'service-worker.js')).toBe(worker);
    expect(await read(dir, 'html/tradeoffers.html')).toBe(
      files['html/tradeoffers.html'].replace('<head>\n', `<head>${SHIM_TAG}\n`),
    );
    expect(await read(dir, 'dist/index.html')).toBe(
      files['dist/index.html'].replace('<head>', `<head>${SHIM_TAG}`),
    );
    // Opened from the popup, and reads storage.sync like the rest.
    expect(await read(dir, 'html/bookmarks.html')).toContain(`<head>${SHIM_TAG}<meta`);
    expect(await read(dir, 'latestchanges/en.html')).toBe(files['latestchanges/en.html']);
    await expect(fs.access(join(dir, '_metadata'))).rejects.toThrow();
    expect(await read(dir, '_locales/ru/messages.json')).toBe(files['_locales/ru/messages.json']);

    // And it still reads as the same extension.
    const after = await readManifest(dir);
    expect(after).toMatchObject({ name: 'Synthetic Inventory Helper', version: '2.12.1' });
  });
});
