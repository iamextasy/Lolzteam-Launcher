import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ExtensionError } from '../errors';
import {
  MAX_ICON_BYTES,
  UNSUPPORTED_PERMISSIONS,
  compareVersions,
  extensionPath,
  isValidVersion,
  parseLooseJson,
  readManifest,
  splitPageRef,
  unsupportedPermissions,
} from '../manifest';
import { FAKE_PNG, writeTree } from './helpers';

const scratch = mkdtempSync(join(tmpdir(), 'lzt-manifest-'));
afterAll(() => fs.rm(scratch, { recursive: true, force: true }));

let n = 0;
/** A fresh extension folder holding `manifest` (an object, or raw text) and any other files. */
const ext = async (
  manifest: Record<string, unknown> | string,
  files: Record<string, string | Buffer> = {},
): Promise<string> => {
  const dir = join(scratch, `ext-${++n}`);
  await writeTree(dir, {
    'manifest.json': typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    ...files,
  });
  return dir;
};

const base = { manifest_version: 3, name: 'Synthetic', version: '1.0' };

const failure = async (dir: string): Promise<ExtensionError> => {
  try {
    await readManifest(dir);
  } catch (err) {
    if (err instanceof ExtensionError) return err;
    throw err;
  }
  throw new Error('expected a failure');
};

describe('readManifest — validation', () => {
  it('accepts a minimal MV3 and MV2 manifest', async () => {
    expect(await readManifest(await ext(base))).toEqual({
      manifestVersion: 3,
      name: 'Synthetic',
      version: '1.0',
      description: '',
      permissions: [],
      hostPermissions: [],
      popupPage: null,
      optionsPage: null,
      icon: null,
    });
    expect((await readManifest(await ext({ ...base, manifest_version: 2 }))).manifestVersion).toBe(
      2,
    );
  });

  it('says bad_manifest for a missing, non-JSON or non-object manifest', async () => {
    const empty = join(scratch, 'empty');
    await fs.mkdir(empty, { recursive: true });
    expect((await failure(empty)).code).toBe('bad_manifest');
    expect((await failure(await ext('{ not json'))).code).toBe('bad_manifest');
    expect((await failure(await ext('[1, 2]'))).code).toBe('bad_manifest');
  });

  it('says unsupported_manifest for MV1, unknown versions, apps and themes', async () => {
    expect((await failure(await ext({ name: 'x', version: '1' }))).code).toBe(
      'unsupported_manifest',
    );
    expect((await failure(await ext({ ...base, manifest_version: 4 }))).code).toBe(
      'unsupported_manifest',
    );
    expect((await failure(await ext({ ...base, app: { launch: {} } }))).code).toBe(
      'unsupported_manifest',
    );
    expect((await failure(await ext({ ...base, theme: { colors: {} } }))).code).toBe(
      'unsupported_manifest',
    );
  });

  it('wants a name and a version Chrome would accept', async () => {
    expect((await failure(await ext({ ...base, name: '  ' }))).code).toBe('bad_manifest');
    for (const version of ['', '1.0.0.0.0', '01.0', '1.x', '70000', '-1', 1]) {
      expect((await failure(await ext({ ...base, version }))).code).toBe('bad_manifest');
    }
  });

  it('checks the background script is in the package', async () => {
    expect(
      (await failure(await ext({ ...base, background: { service_worker: 'gone.js' } }))).message,
    ).toMatch(/gone\.js/);
    expect(
      (await failure(await ext({ ...base, background: { service_worker: '../outside.js' } }))).code,
    ).toBe('bad_manifest');
    expect(
      (
        await failure(
          await ext(
            { ...base, manifest_version: 2, background: { scripts: ['a.js', 'b.js'] } },
            {
              'a.js': '',
            },
          ),
        )
      ).message,
    ).toMatch(/b\.js/);
    const ok = await ext(
      { ...base, background: { service_worker: '/bg/sw.js' } },
      { 'bg/sw.js': '' },
    );
    await expect(readManifest(ok)).resolves.toBeTruthy();
  });

  it('tolerates a byte-order mark, comments and trailing commas, as Chrome does', async () => {
    const text = `﻿{
      // the name
      "manifest_version": 3, /* block */ "name": "Commented // not a comment",
      "version": "1.0",
    }`;
    expect((await readManifest(await ext(text))).name).toBe('Commented // not a comment');
  });
});

describe('readManifest — localisation', () => {
  const messages = {
    appName: { message: 'Synthetic $WHO$ Helper', placeholders: { who: { content: 'Inventory' } } },
    APPDESC: { message: 'Costs $$5 and $1 nothing' },
  };

  it('resolves __MSG_x__ from the default locale, keys in any case', async () => {
    const dir = await ext(
      { ...base, name: '__MSG_appname__', description: '__MSG_appDesc__!', default_locale: 'en' },
      { '_locales/en/messages.json': JSON.stringify(messages) },
    );
    expect(await readManifest(dir)).toMatchObject({
      name: 'Synthetic Inventory Helper',
      description: 'Costs $5 and  nothing!',
    });
  });

  it('finds the locale folder whatever its case or separator', async () => {
    const dir = await ext(
      { ...base, name: '__MSG_appName__', default_locale: 'pt_BR' },
      { '_locales/pt-br/messages.json': JSON.stringify(messages) },
    );
    expect((await readManifest(dir)).name).toBe('Synthetic Inventory Helper');
  });

  it('replaces an unknown key with nothing — and an empty name is then refused', async () => {
    const dir = await ext(
      { ...base, name: 'X __MSG_missing__', default_locale: 'en' },
      { '_locales/en/messages.json': '{}' },
    );
    expect((await readManifest(dir)).name).toBe('X');
    const nameless = await ext(
      { ...base, name: '__MSG_missing__', default_locale: 'en' },
      { '_locales/en/messages.json': '{}' },
    );
    expect((await failure(nameless)).code).toBe('bad_manifest');
  });

  it('refuses a default locale with no messages, and locales with no default', async () => {
    expect((await failure(await ext({ ...base, default_locale: 'en' }))).message).toMatch(
      /_locales\/en/,
    );
    expect((await failure(await ext(base, { '_locales/en/messages.json': '{}' }))).message).toMatch(
      /default_locale/,
    );
  });
});

describe('readManifest — permissions', () => {
  it('splits MV2 permissions into API permissions and hosts', async () => {
    const info = await readManifest(
      await ext({
        ...base,
        manifest_version: 2,
        permissions: ['storage', 'https://example.test/*', 'cookies', '<all_urls>', 7, 'storage'],
      }),
    );
    expect(info.permissions).toEqual(['storage', 'cookies']);
    expect(info.hostPermissions).toEqual(['<all_urls>']);
  });

  it('adds the sites content scripts run on to the hosts, without repeats', async () => {
    const info = await readManifest(
      await ext({
        ...base,
        permissions: ['storage'],
        host_permissions: ['https://api.example.test/*'],
        content_scripts: [
          { matches: ['https://example.test/*', 'https://api.example.test/*'], js: [] },
          { matches: ['*://*.example.test/trade/*'], js: [] },
          'nonsense',
        ],
      }),
    );
    expect(info.hostPermissions).toEqual([
      'https://api.example.test/*',
      'https://example.test/*',
      '*://*.example.test/trade/*',
    ]);
  });

  it('collapses to the all-sites pattern when there is one', async () => {
    const info = await readManifest(
      await ext({
        ...base,
        host_permissions: ['<all_urls>'],
        content_scripts: [{ matches: ['https://example.test/*'], js: [] }],
      }),
    );
    expect(info.hostPermissions).toEqual(['<all_urls>']);
  });

  it('lists what Electron 33 cannot do', () => {
    expect(
      unsupportedPermissions(['storage', 'notifications', 'cookies', 'alarms', 'contextMenus']),
    ).toEqual(['notifications', 'cookies', 'contextMenus']);
    for (const works of ['storage', 'alarms', 'webRequest', 'declarativeNetRequest', 'scripting']) {
      expect(UNSUPPORTED_PERMISSIONS.has(works)).toBe(false);
    }
  });
});

describe('readManifest — pages and icon', () => {
  it('finds the MV3 popup and options page, query kept, only when the files exist', async () => {
    const info = await readManifest(
      await ext(
        {
          ...base,
          action: { default_popup: '/html/popup.html?mode=popup' },
          options_ui: { page: 'dist/index.html', open_in_tab: true },
        },
        { 'html/popup.html': '', 'dist/index.html': '' },
      ),
    );
    expect(info).toMatchObject({
      popupPage: 'html/popup.html?mode=popup',
      optionsPage: 'dist/index.html',
    });

    const missing = await readManifest(
      await ext({ ...base, action: { default_popup: 'nope.html' }, options_page: 'gone.html' }),
    );
    expect(missing).toMatchObject({ popupPage: null, optionsPage: null });
  });

  it('finds the MV2 browser_action or page_action popup and options_page', async () => {
    const mv2 = { ...base, manifest_version: 2 };
    const browser = await readManifest(
      await ext(
        { ...mv2, browser_action: { default_popup: 'b.html' }, options_page: 'o.html' },
        { 'b.html': '', 'o.html': '' },
      ),
    );
    expect(browser).toMatchObject({ popupPage: 'b.html', optionsPage: 'o.html' });
    const page = await readManifest(
      await ext({ ...mv2, page_action: { default_popup: 'p.html' } }, { 'p.html': '' }),
    );
    expect(page.popupPage).toBe('p.html');
  });

  it('refuses page paths that leave the extension', async () => {
    const info = await readManifest(
      await ext(
        { ...base, action: { default_popup: '../x.html' }, options_page: 'https://evil.test/' },
        {},
      ),
    );
    expect(info).toMatchObject({ popupPage: null, optionsPage: null });
  });

  it('takes the largest readable icon as a data: URL', async () => {
    const info = await readManifest(
      await ext(
        { ...base, icons: { '16': 'i16.png', '128': 'i128.png', '48': 'i48.png' } },
        { 'i16.png': FAKE_PNG, 'i48.png': FAKE_PNG, 'i128.png': Buffer.from('large-icon') },
      ),
    );
    expect(info.icon).toBe(`data:image/png;base64,${Buffer.from('large-icon').toString('base64')}`);
  });

  it('skips icons that are too big, missing or of an unknown type, then tries the toolbar icon', async () => {
    const info = await readManifest(
      await ext(
        {
          ...base,
          icons: { '512': 'huge.png', '256': 'gone.png', '128': 'icon.bmp' },
          action: { default_icon: { '32': 'a32.svg' } },
        },
        {
          'huge.png': Buffer.alloc(MAX_ICON_BYTES + 1),
          'icon.bmp': FAKE_PNG,
          'a32.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
        },
      ),
    );
    expect(info.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    const single = await readManifest(
      await ext({ ...base, action: { default_icon: 'one.webp' } }, { 'one.webp': FAKE_PNG }),
    );
    expect(single.icon).toMatch(/^data:image\/webp;base64,/);
  });
});

describe('helpers', () => {
  it('isValidVersion and compareVersions follow Chrome', () => {
    expect(['1', '1.0', '2.12.1', '0.0.0.1', '65535.0'].every(isValidVersion)).toBe(true);
    expect(
      ['', '1.', '.1', '1..2', '1.0.0.0.0', '65536', '01', '1.02', 'v1'].some(isValidVersion),
    ).toBe(false);
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1')).toBe(0);
    expect(compareVersions('1.0.0.1', '1.0.1')).toBeLessThan(0);
  });

  it('extensionPath keeps paths inside the extension', () => {
    expect(extensionPath('/js/./a.js')).toBe('js/a.js');
    expect(extensionPath('a\\b.js')).toBeNull();
    expect(extensionPath('../a.js')).toBeNull();
    expect(extensionPath('chrome-extension://x/a.js')).toBeNull();
    expect(extensionPath('')).toBeNull();
    expect(extensionPath(5)).toBeNull();
    expect(splitPageRef('p.html#top')).toEqual({ file: 'p.html', suffix: '#top' });
  });

  it('parseLooseJson leaves strings that look like comments alone', () => {
    expect(parseLooseJson('{"a": "// x /* y */", "b": [1, 2,],}')).toEqual({
      a: '// x /* y */',
      b: [1, 2],
    });
  });
});
