import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  BrowserExtensionInfo,
  ExtensionErrorCode,
  ExtensionInstallPreview,
} from '@shared-types';
import { describe, expect, it } from 'vitest';
import {
  ALL_ERROR_KEYS,
  ERROR_KEYS,
  NAMED_PERMISSIONS,
  errorKey,
  hostAccess,
  isReinstall,
  patternHost,
  permissionKey,
  replacesStoreInstall,
} from '../browserExtensions';

/** Synthetic ids: 32 letters a–p, as Chrome spells them. */
const ID_A = 'abcdefghijklmnopabcdefghijklmnop';
const ID_B = 'ponmlkjihgfedcbaponmlkjihgfedcba';

const info = (over: Partial<BrowserExtensionInfo> = {}): BrowserExtensionInfo => ({
  id: ID_A,
  name: 'Example Helper',
  version: '1.2.3',
  description: '',
  enabled: true,
  source: 'webstore',
  manifestVersion: 3,
  permissions: [],
  hostPermissions: [],
  hasPopup: false,
  hasOptions: false,
  icon: null,
  installedAt: 1,
  ...over,
});

const preview = (
  over: Partial<ExtensionInstallPreview['extension']> = {},
  replaces: string | null = null,
): ExtensionInstallPreview => {
  const { enabled: _e, installedAt: _i, ...extension } = info(over);
  return { stagingId: 'staging-1', extension, replaces, unsupported: [] };
};

describe('hostAccess', () => {
  it('says «every site» for <all_urls> and for a * host under any scheme', () => {
    expect(hostAccess(['<all_urls>'])).toEqual({ kind: 'all' });
    expect(hostAccess(['*://*/*'])).toEqual({ kind: 'all' });
    expect(hostAccess(['https://*/*', 'https://example.test/*'])).toEqual({ kind: 'all' });
  });

  it('names the sites by host, once each', () => {
    expect(
      hostAccess([
        '*://steamcommunity.com/tradeoffer/*',
        '*://steamcommunity.com/trade/*',
        'https://*.example.test/*',
      ]),
    ).toEqual({ kind: 'some', hosts: ['steamcommunity.com', '*.example.test'], more: 0 });
  });

  it('counts what does not fit', () => {
    const many = Array.from({ length: 9 }, (_, i) => `https://site${i}.test/*`);
    const res = hostAccess(many, 6);
    expect(res).toEqual({
      kind: 'some',
      hosts: many.slice(0, 6).map(patternHost),
      more: 3,
    });
  });

  it('says «none» for no patterns at all', () => {
    expect(hostAccess([])).toEqual({ kind: 'none' });
  });
});

describe('patternHost', () => {
  it('drops the scheme and the path', () => {
    expect(patternHost('*://*.steamcommunity.com/*')).toBe('*.steamcommunity.com');
    expect(patternHost('https://example.test/a/b*')).toBe('example.test');
    expect(patternHost('http://localhost:8080/*')).toBe('localhost:8080');
  });

  it('leaves what is not a match pattern as it is', () => {
    expect(patternHost('file:///*')).toBe('file:///*');
    expect(patternHost('something odd')).toBe('something odd');
  });
});

describe('permissionKey', () => {
  it('has words for the permissions it names', () => {
    expect(permissionKey('cookies')).toBe('settings.browser.extensions.perm.cookies');
    expect(permissionKey('unlimitedStorage')).toBe(
      'settings.browser.extensions.perm.unlimitedStorage',
    );
  });

  it('leaves an unknown or dotted permission to be shown as Chrome spells it', () => {
    expect(permissionKey('downloads.open')).toBeNull();
    expect(permissionKey('fileSystemProvider')).toBeNull();
    expect(permissionKey('__proto__')).toBeNull();
  });
});

describe('errorKey', () => {
  it('maps every code to its own message', () => {
    for (const code of Object.keys(ERROR_KEYS) as ExtensionErrorCode[]) {
      expect(errorKey(code)).toBe(`settings.browser.extensions.errors.${code}`);
    }
  });

  it('blames the path, not the link, for a picked file or folder', () => {
    expect(errorKey('bad_input', 'webstore')).toBe(ERROR_KEYS.bad_input);
    expect(errorKey('bad_input', 'file')).toBe('settings.browser.extensions.errors.bad_input_path');
    expect(errorKey('bad_input', 'folder')).toBe(
      'settings.browser.extensions.errors.bad_input_path',
    );
    expect(errorKey('bad_manifest', 'folder')).toBe(ERROR_KEYS.bad_manifest);
  });

  it('tells an expired preview and a vanished extension from a store without it', () => {
    expect(errorKey('not_found', 'webstore')).toBe(ERROR_KEYS.not_found);
    expect(errorKey('not_found', 'update')).toBe(ERROR_KEYS.not_found);
    expect(errorKey('not_found', 'commit')).toBe('settings.browser.extensions.errors.expired');
    expect(errorKey('not_found', 'manage')).toBe('settings.browser.extensions.errors.gone');
    expect(errorKey('io', 'commit')).toBe(ERROR_KEYS.io);
  });

  it('reads anything else as an I/O failure', () => {
    expect(errorKey('toString')).toBe(ERROR_KEYS.io);
    expect(errorKey(undefined)).toBe(ERROR_KEYS.io);
    expect(errorKey(42)).toBe(ERROR_KEYS.io);
  });
});

describe('replacesStoreInstall', () => {
  const installed = [info({ id: ID_A, source: 'webstore' }), info({ id: ID_B, source: 'file' })];

  it('flags a file that takes over the id of a store install', () => {
    expect(replacesStoreInstall(preview({ id: ID_A, source: 'file' }, '1.2.3'), installed)).toBe(
      true,
    );
  });

  it('leaves a store update, a file over a file, and a new id alone', () => {
    expect(
      replacesStoreInstall(preview({ id: ID_A, source: 'webstore' }, '1.2.3'), installed),
    ).toBe(false);
    expect(replacesStoreInstall(preview({ id: ID_B, source: 'file' }, '1.2.3'), installed)).toBe(
      false,
    );
    expect(replacesStoreInstall(preview({ id: ID_A, source: 'file' }), [])).toBe(false);
  });
});

describe('isReinstall', () => {
  it('is the same version over itself', () => {
    expect(isReinstall(preview({ version: '1.2.3' }, '1.2.3'))).toBe(true);
    expect(isReinstall(preview({ version: '1.3.0' }, '1.2.3'))).toBe(false);
    expect(isReinstall(preview({ version: '1.2.3' }, null))).toBe(false);
  });
});

/** Every key the page builds from these helpers is in both dictionaries — a missing one would show the bare key. */
describe('the dictionaries', () => {
  type Dict = Record<string, unknown>;
  const load = (lang: string): Dict =>
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../../i18n/locales/${lang}.json`, import.meta.url)),
        'utf8',
      ),
    ) as Dict;
  const lookup = (dict: Dict, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Dict | undefined)?.[part], dict);

  for (const lang of ['ru', 'en']) {
    const dict = load(lang);

    it(`${lang}: names every permission it claims to`, () => {
      for (const permission of NAMED_PERMISSIONS) {
        expect(typeof lookup(dict, permissionKey(permission) ?? ''), permission).toBe('string');
      }
    });

    it(`${lang}: has a message for every error`, () => {
      for (const key of ALL_ERROR_KEYS) {
        expect(typeof lookup(dict, key), key).toBe('string');
      }
    });
  }
});
