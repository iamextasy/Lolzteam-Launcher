import { createHash } from 'node:crypto';
import { promises as fs, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserExtensionInfo, ExtensionInstallPreview, ExtensionResult } from '@shared-types';
import type { Session } from 'electron';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_PNG,
  idOf,
  makeCrx3,
  makeRsaKey,
  mv3Tree,
  readJson,
  writeTree,
  zipTree,
} from './helpers';

// The only things Electron is asked for: `userData`, and the network for store downloads.
const userData = mkdtempSync(join(tmpdir(), 'lzt-extensions-'));
const packages = mkdtempSync(join(tmpdir(), 'lzt-extension-packages-'));
const fetchMock = vi.fn<(url: string, init?: unknown) => Promise<Response>>();

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  net: { fetch: (url: string, init?: unknown) => fetchMock(url, init) },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ext = await import('../index');
const { PATCH_VERSION } = await import('../patch');

const root = join(userData, 'extensions');
const staging = join(root, '.staging');

const clean = async (): Promise<void> => {
  ext.resetExtensionsForTests();
  for (const name of await fs.readdir(userData)) {
    await fs.rm(join(userData, name), { force: true, recursive: true });
  }
  fetchMock.mockReset();
};

beforeEach(clean);
afterEach(clean);
afterAll(async () => {
  await fs.rm(userData, { recursive: true, force: true });
  await fs.rm(packages, { recursive: true, force: true });
});

const value = <T>(result: ExtensionResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}: ${result.message}`);
  return result.value;
};

const errorOf = <T>(result: ExtensionResult<T>): string => {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

let n = 0;
/** Writes `data` as a package file outside userData, as a user's download would be. */
const packageFile = async (data: Buffer, ext = '.zip'): Promise<string> => {
  const path = join(packages, `pkg-${++n}${ext}`);
  await fs.writeFile(path, data);
  return path;
};

const installZip = async (tree: Record<string, string | Buffer>): Promise<BrowserExtensionInfo> => {
  const preview = value(
    await ext.prepareExtensionInstall({ kind: 'file', path: await packageFile(zipTree(tree)) }),
  );
  return value(await ext.commitExtensionInstall(preview.stagingId));
};

const registry = () => readJson(join(root, 'registry.json'));

/** Enough of a Session for the loader: it reads the id from the patched manifest's key, as Chromium would. */
const fakeSession = (opts: { failFor?: (path: string) => boolean } = {}) => {
  const loaded = new Map<string, { id: string; name: string; version: string; path: string }>();
  const raw = {
    loadExtension: vi.fn(async (path: string) => {
      if (opts.failFor?.(path)) throw new Error('Manifest file is missing or unreadable');
      const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
      const id = idOf(Buffer.from(manifest.key, 'base64'));
      const e = { id, name: manifest.name, version: manifest.version, path };
      loaded.set(id, e);
      return e;
    }),
    removeExtension: vi.fn((id: string) => {
      loaded.delete(id);
    }),
    getExtension: vi.fn((id: string) => loaded.get(id) ?? null),
    getAllExtensions: vi.fn(() => [...loaded.values()]),
  };
  return { ses: raw as unknown as Session, loaded, raw };
};

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('install from a file', () => {
  it('previews a keyless zip, then installs it under <id>/<version> with a stable key', async () => {
    const path = await packageFile(zipTree(mv3Tree()));
    const preview = value(await ext.prepareExtensionInstall({ kind: 'file', path }));
    expect(preview).toMatchObject<Partial<ExtensionInstallPreview>>({
      replaces: null,
      unsupported: ['notifications'],
    });
    expect(preview.extension).toMatchObject({
      name: 'Synthetic Helper',
      version: '1.0',
      source: 'file',
      manifestVersion: 3,
      permissions: ['storage', 'notifications'],
      hostPermissions: ['https://example.test/*'],
      hasPopup: true,
      hasOptions: true,
    });
    expect(preview.extension.icon).toBe(`data:image/png;base64,${FAKE_PNG.toString('base64')}`);
    expect(await fs.readdir(staging)).toEqual([preview.stagingId]);
    // Nothing is installed until the user says yes.
    expect(await ext.listExtensions()).toEqual([]);

    const info = value(await ext.commitExtensionInstall(preview.stagingId));
    expect(info).toMatchObject({ ...preview.extension, enabled: true });
    expect(await ext.listExtensions()).toEqual([info]);
    expect(await fs.readdir(staging)).toEqual([]);

    const manifest = await readJson(join(root, info.id, '1.0', 'manifest.json'));
    expect(idOf(Buffer.from(manifest.key as string, 'base64'))).toBe(info.id);
    expect(await registry()).toEqual({
      version: 1,
      extensions: [
        {
          ...info,
          dir: `${info.id}/1.0`,
          popupPage: 'popup.html',
          optionsPage: 'options.html',
          patchVersion: PATCH_VERSION,
          generatedKey: manifest.key,
        },
      ],
    });
  });

  it('finds the extension inside the one folder a zip wraps it in', async () => {
    const nested = Object.fromEntries(
      Object.entries(mv3Tree()).map(([name, data]) => [`synthetic-helper/${name}`, data]),
    );
    const info = await installZip({ ...nested, '__MACOSX/._x': 'junk' });
    expect(info.name).toBe('Synthetic Helper');
    await fs.access(join(root, info.id, '1.0', 'manifest.json'));
  });

  it('installs a CRX under the id its key gives', async () => {
    const key = makeRsaKey();
    const path = await packageFile(makeCrx3(zipTree(mv3Tree()), [key]), '.crx');
    const preview = value(await ext.prepareExtensionInstall({ kind: 'file', path }));
    expect(preview.extension.id).toBe(idOf(key.publicDer));
    const info = value(await ext.commitExtensionInstall(preview.stagingId));
    expect(info.source).toBe('file');
    expect((await registry()).extensions).toMatchObject([{ generatedKey: null }]);
  });

  it('refuses what it cannot install, leaving no staging behind', async () => {
    const notAPackage = await packageFile(Buffer.from('hello'), '.zip');
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'file', path: notAPackage }))).toBe(
      'bad_package',
    );
    const noManifest = await packageFile(zipTree({ 'a.js': '' }));
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'file', path: noManifest }))).toBe(
      'bad_manifest',
    );
    const mv1 = await packageFile(
      zipTree({ 'manifest.json': JSON.stringify({ name: 'Old', version: '1' }) }),
    );
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'file', path: mv1 }))).toBe(
      'unsupported_manifest',
    );
    const tampered = await packageFile(
      makeCrx3(zipTree(mv3Tree()), [makeRsaKey()], { swapZip: zipTree(mv3Tree({ name: 'Evil' })) }),
      '.crx',
    );
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'file', path: tampered }))).toBe(
      'bad_package',
    );
    expect(
      errorOf(
        await ext.prepareExtensionInstall({ kind: 'file', path: join(packages, 'none.zip') }),
      ),
    ).toBe('bad_input');
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'file', path: 'relative.zip' }))).toBe(
      'bad_input',
    );
    expect(await fs.readdir(staging)).toEqual([]);
  });

  it('discard drops the staged copy, and the staging id is then unknown', async () => {
    const path = await packageFile(zipTree(mv3Tree()));
    const preview = value(await ext.prepareExtensionInstall({ kind: 'file', path }));
    await ext.discardExtensionInstall(preview.stagingId);
    expect(await fs.readdir(staging)).toEqual([]);
    expect(errorOf(await ext.commitExtensionInstall(preview.stagingId))).toBe('not_found');
    await ext.discardExtensionInstall('never-staged');
  });
});

describe('install from a folder', () => {
  it('copies the folder first and never changes the user’s own files', async () => {
    const folder = join(packages, `folder-${++n}`);
    await writeTree(folder, { ...mv3Tree(), '.git/HEAD': 'ref: refs/heads/main' });
    const before = await fs.readFile(join(folder, 'manifest.json'), 'utf8');

    const preview = value(await ext.prepareExtensionInstall({ kind: 'folder', path: folder }));
    const info = value(await ext.commitExtensionInstall(preview.stagingId));

    expect(await fs.readFile(join(folder, 'manifest.json'), 'utf8')).toBe(before);
    expect((await fs.readdir(folder)).sort()).toEqual(
      ['.git', 'cs.js', 'icon.png', 'manifest.json', 'options.html', 'popup.html', 'sw.js'].sort(),
    );
    await expect(fs.access(join(root, info.id, '1.0', '.git'))).rejects.toThrow();
    await fs.access(join(root, info.id, '1.0', 'lzt-compat', 'shim.js'));
  });

  // Windows wants a privilege for symlinks that a developer's shell may not have.
  it.skipIf(process.platform === 'win32')(
    'copies links to files inside the folder, and skips links that lead out of it',
    async () => {
      const outside = join(packages, `secret-${++n}.txt`);
      await fs.writeFile(outside, 'synthetic secret');
      const folder = join(packages, `folder-${++n}`);
      await writeTree(folder, { ...mv3Tree(), 'lib/real.js': 'shared();' });
      await fs.symlink(join(folder, 'lib', 'real.js'), join(folder, 'linked.js'));
      await fs.symlink(outside, join(folder, 'leak.txt'));
      await fs.symlink(packages, join(folder, 'everything'));

      const preview = value(await ext.prepareExtensionInstall({ kind: 'folder', path: folder }));
      const info = value(await ext.commitExtensionInstall(preview.stagingId));
      const dir = join(root, info.id, '1.0');
      expect(await fs.readFile(join(dir, 'linked.js'), 'utf8')).toBe('shared();');
      expect((await fs.lstat(join(dir, 'linked.js'))).isSymbolicLink()).toBe(false);
      await expect(fs.access(join(dir, 'leak.txt'))).rejects.toThrow();
      await expect(fs.access(join(dir, 'everything'))).rejects.toThrow();
    },
  );

  it('refuses a folder with no manifest before copying anything', async () => {
    const folder = join(packages, `folder-${++n}`);
    await writeTree(folder, { 'readme.txt': 'not an extension' });
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'folder', path: folder }))).toBe(
      'bad_manifest',
    );
  });

  it('reinstalling from an installed folder keeps the id and does not stack patches', async () => {
    const first = await installZip(mv3Tree());
    const installed = join(root, first.id, '1.0');
    const preview = value(await ext.prepareExtensionInstall({ kind: 'folder', path: installed }));
    expect(preview.extension.id).toBe(first.id);
    expect(preview.replaces).toBe('1.0');
    expect(preview.extension.hostPermissions).toEqual(['https://example.test/*']);
    const info = value(await ext.commitExtensionInstall(preview.stagingId));
    // The same version again: a fresh folder beside the one in use, which then goes.
    expect((await registry()).extensions).toMatchObject([
      { id: first.id, dir: `${first.id}/1.0-2` },
    ]);
    expect(await fs.readdir(join(root, info.id))).toEqual(['1.0-2']);
    const manifest = await readJson(join(root, info.id, '1.0-2', 'manifest.json'));
    expect(manifest.content_scripts).toHaveLength(2);
  });
});

describe('replace, remove, toggle', () => {
  it('names the version it replaces, swaps folders, keeps the place in the list', async () => {
    const key = makeRsaKey();
    const v1 = await packageFile(makeCrx3(zipTree(mv3Tree({ version: '1.0' })), [key]), '.crx');
    const first = value(
      await ext.commitExtensionInstall(
        value(await ext.prepareExtensionInstall({ kind: 'file', path: v1 })).stagingId,
      ),
    );
    await installZip(mv3Tree({ name: 'Another' }));

    const v2 = await packageFile(makeCrx3(zipTree(mv3Tree({ version: '1.1' })), [key]), '.crx');
    const preview = value(await ext.prepareExtensionInstall({ kind: 'file', path: v2 }));
    expect(preview.replaces).toBe('1.0');
    const second = value(await ext.commitExtensionInstall(preview.stagingId));

    expect(second).toMatchObject({ id: first.id, version: '1.1', installedAt: first.installedAt });
    expect((await ext.listExtensions()).map((e) => [e.name, e.version])).toEqual([
      ['Synthetic Helper', '1.1'],
      ['Another', '1.0'],
    ]);
    expect(await fs.readdir(join(root, first.id))).toEqual(['1.1']);
  });

  it('gives a keyless package the same id across versions', async () => {
    const first = await installZip(mv3Tree({ version: '1.0' }));
    const path = await packageFile(zipTree(mv3Tree({ version: '2.0' })));
    const preview = value(await ext.prepareExtensionInstall({ kind: 'file', path }));
    expect(preview.extension.id).toBe(first.id);
    expect(preview.replaces).toBe('1.0');
    // A different package gets an id of its own.
    const other = await installZip(mv3Tree({ name: 'Different' }));
    expect(other.id).not.toBe(first.id);
  });

  it('removes the files and the entry; a second removal is not_found', async () => {
    const info = await installZip(mv3Tree());
    expect(value(await ext.removeExtension(info.id))).toBeNull();
    expect(await ext.listExtensions()).toEqual([]);
    await expect(fs.access(join(root, info.id))).rejects.toThrow();
    expect((await registry()).extensions).toEqual([]);
    expect(errorOf(await ext.removeExtension(info.id))).toBe('not_found');
  });

  it('toggles, tells listeners, and keeps the URL check in step', async () => {
    const changes = vi.fn();
    const off = ext.onExtensionsChange(changes);
    const info = await installZip(mv3Tree());
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: info.id, enabled: true }),
    ]);

    const url = `chrome-extension://${info.id}/popup.html`;
    expect(ext.isEnabledExtensionUrl(url)).toBe(true);
    expect(value(await ext.setExtensionEnabled(info.id, false)).enabled).toBe(false);
    expect(ext.isEnabledExtensionUrl(url)).toBe(false);
    expect(changes).toHaveBeenLastCalledWith([expect.objectContaining({ enabled: false })]);
    expect((await registry()).extensions).toMatchObject([{ enabled: false }]);

    off();
    await ext.setExtensionEnabled(info.id, true);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(ext.isEnabledExtensionUrl(url)).toBe(true);
    expect(errorOf(await ext.setExtensionEnabled('abcdefghijklmnopabcdefghijklmnop', true))).toBe(
      'not_found',
    );
  });

  it('isEnabledExtensionUrl refuses anything but an enabled extension’s URL', async () => {
    const info = await installZip(mv3Tree());
    expect(ext.isEnabledExtensionUrl(`https://${info.id}/`)).toBe(false);
    expect(ext.isEnabledExtensionUrl('chrome-extension://abcdefghijklmnopabcdefghijklmnop/x')).toBe(
      false,
    );
    expect(ext.isEnabledExtensionUrl('not a url')).toBe(false);
  });

  it('builds page URLs only for enabled extensions that have the page', async () => {
    const info = await installZip(
      mv3Tree({
        manifest: { action: { default_popup: 'popup.html?mode=popup' }, options_ui: undefined },
      }),
    );
    expect(await ext.extensionPageUrl(info.id, 'popup')).toBe(
      `chrome-extension://${info.id}/popup.html?mode=popup`,
    );
    expect(await ext.extensionPageUrl(info.id, 'options')).toBeNull();
    await ext.setExtensionEnabled(info.id, false);
    expect(await ext.extensionPageUrl(info.id, 'popup')).toBeNull();
    expect(await ext.extensionPageUrl('abcdefghijklmnopabcdefghijklmnop', 'popup')).toBeNull();
  });
});

describe('sessions', () => {
  it('loads enabled extensions once, and applies every later change live', async () => {
    const a = await installZip(mv3Tree({ name: 'A' }));
    const b = await installZip(mv3Tree({ name: 'B' }));
    await ext.setExtensionEnabled(b.id, false);

    const { ses, loaded, raw } = fakeSession();
    const log = logger();
    await ext.loadSessionExtensions(ses, log);
    expect([...loaded.keys()]).toEqual([a.id]);
    expect(loaded.get(a.id)?.path).toBe(join(root, a.id, '1.0'));
    expect(raw.loadExtension).toHaveBeenCalledWith(join(root, a.id, '1.0'), {
      allowFileAccess: false,
    });

    await ext.loadSessionExtensions(ses, log);
    expect(raw.loadExtension).toHaveBeenCalledTimes(1);

    await ext.setExtensionEnabled(b.id, true);
    expect([...loaded.keys()].sort()).toEqual([a.id, b.id].sort());
    await ext.setExtensionEnabled(a.id, false);
    expect([...loaded.keys()]).toEqual([b.id]);

    // An update replaces the folder: the old one is unloaded, the new one loaded.
    const path = await packageFile(zipTree(mv3Tree({ name: 'B', version: '2.0' })));
    const preview = value(await ext.prepareExtensionInstall({ kind: 'file', path }));
    expect(preview.extension.id).toBe(b.id);
    await ext.commitExtensionInstall(preview.stagingId);
    expect(loaded.get(b.id)?.path).toBe(join(root, b.id, '2.0'));

    await ext.removeExtension(b.id);
    expect(loaded.size).toBe(0);
  });

  it('unloads only its own extensions, and loads them again after', async () => {
    const a = await installZip(mv3Tree());
    const { ses, loaded, raw } = fakeSession();
    loaded.set('ponmlkjihgfedcbaponmlkjihgfedcba', {
      id: 'ponmlkjihgfedcbaponmlkjihgfedcba',
      name: 'Not ours',
      version: '1',
      path: join(packages, 'elsewhere'),
    });
    await ext.loadSessionExtensions(ses, logger());
    await ext.unloadSessionExtensions(ses);
    expect([...loaded.keys()]).toEqual(['ponmlkjihgfedcbaponmlkjihgfedcba']);
    await ext.loadSessionExtensions(ses, logger());
    expect(loaded.has(a.id)).toBe(true);
    expect(raw.removeExtension).toHaveBeenCalledTimes(1);
  });

  it('holds a session empty between unload and load, whatever changes meanwhile', async () => {
    const a = await installZip(mv3Tree({ name: 'A' }));
    const b = await installZip(mv3Tree({ name: 'B' }));
    await ext.setExtensionEnabled(b.id, false);
    const { ses, loaded } = fakeSession();
    await ext.loadSessionExtensions(ses, logger());

    // The window is about to clear the session's storage: nothing may be loaded into it until it is done.
    await ext.unloadSessionExtensions(ses);
    await ext.setExtensionEnabled(b.id, true);
    await installZip(mv3Tree({ name: 'C' }));
    expect(loaded.size).toBe(0);

    await ext.loadSessionExtensions(ses, logger());
    expect(loaded.size).toBe(3);
    expect(loaded.has(a.id)).toBe(true);
  });

  /** One login of an account, as `injectCookies` runs it: out before the wipe, back in after. */
  const login = async (ses: Session): Promise<void> => {
    await ext.unloadSessionExtensions(ses);
    await ext.loadSessionExtensions(ses, logger());
  };

  it('keeps the extensions while any window of the account is open, and takes them with the last', async () => {
    const a = await installZip(mv3Tree({ name: 'A' }));
    const { ses, loaded } = fakeSession();
    await login(ses);
    await login(ses);
    expect([...loaded.keys()]).toEqual([a.id]);

    await ext.releaseSessionExtensions(ses);
    expect([...loaded.keys()]).toEqual([a.id]);
    await ext.releaseSessionExtensions(ses);
    expect(loaded.size).toBe(0);

    // Forgotten: nothing installed later runs as an account with no window open.
    await installZip(mv3Tree({ name: 'B' }));
    expect(loaded.size).toBe(0);
  });

  it('ignores a window of a session it never loaded', async () => {
    await installZip(mv3Tree());
    const { ses, raw } = fakeSession();
    await ext.releaseSessionExtensions(ses);
    await ext.abandonSessionExtensions(ses);
    expect(raw.getAllExtensions).not.toHaveBeenCalled();
  });

  it('a login that gives up hands the session back: the open window keeps its extensions', async () => {
    const a = await installZip(mv3Tree({ name: 'A' }));
    const { ses, loaded } = fakeSession();
    await login(ses);

    // A second login of the account fails between the unload and the load (the proxy, say).
    await ext.unloadSessionExtensions(ses);
    expect(loaded.size).toBe(0);
    await ext.abandonSessionExtensions(ses);
    expect([...loaded.keys()]).toEqual([a.id]);

    // No longer held: live changes reach the open window again, and its close is still the last one.
    const b = await installZip(mv3Tree({ name: 'B' }));
    expect(loaded.has(b.id)).toBe(true);
    await ext.releaseSessionExtensions(ses);
    expect(loaded.size).toBe(0);
  });

  it('a login that gives up with no window open leaves nothing loaded or remembered', async () => {
    await installZip(mv3Tree({ name: 'A' }));
    const failed = fakeSession();
    await ext.unloadSessionExtensions(failed.ses);
    await ext.abandonSessionExtensions(failed.ses);

    // Cancelled after its load: the adapter opens no window.
    const cancelled = fakeSession();
    await login(cancelled.ses);
    expect(cancelled.loaded.size).toBe(1);
    await ext.abandonSessionExtensions(cancelled.ses);
    expect(cancelled.loaded.size).toBe(0);

    await installZip(mv3Tree({ name: 'B' }));
    expect(failed.loaded.size).toBe(0);
    expect(cancelled.loaded.size).toBe(0);
  });

  it('a window closing while another login of the account runs leaves that login alone', async () => {
    const a = await installZip(mv3Tree({ name: 'A' }));
    const { ses, loaded } = fakeSession();
    await login(ses);

    await ext.unloadSessionExtensions(ses);
    await ext.releaseSessionExtensions(ses);
    await ext.loadSessionExtensions(ses, logger());
    expect([...loaded.keys()]).toEqual([a.id]);
    const b = await installZip(mv3Tree({ name: 'B' }));
    expect(loaded.has(b.id)).toBe(true);
  });

  it('logs and skips an extension that will not load, loading the rest', async () => {
    const bad = await installZip(mv3Tree({ name: 'Broken' }));
    const good = await installZip(mv3Tree({ name: 'Fine' }));
    const { ses, loaded } = fakeSession({ failFor: (p) => p.includes(bad.id) });
    const log = logger();
    await expect(ext.loadSessionExtensions(ses, log)).resolves.toBeUndefined();
    expect([...loaded.keys()]).toEqual([good.id]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(bad.id), expect.any(Error));
  });
});

describe('Chrome Web Store', () => {
  const key = makeRsaKey();
  const id = idOf(key.publicDer);
  const link = `https://chromewebstore.google.com/detail/synthetic-helper/${id}?hl=ru`;

  const gupdate = (check: string): string =>
    `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${id}" status="ok">${check}</app></gupdate>`;

  /** The store: an update check that announces `version` with its hash, and the package behind the redirect. */
  const store = (crx: Buffer, version: string, opts: { hash?: string; current?: string } = {}) => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('response=updatecheck')) {
        if (opts.current && url.includes(`v%3D${opts.current}%26`)) {
          return new Response(gupdate('<updatecheck status="noupdate"/>'));
        }
        const hash = opts.hash ?? createHash('sha256').update(crx).digest('hex');
        return new Response(
          gupdate(`<updatecheck status="ok" version="${version}" hash_sha256="${hash}"/>`),
        );
      }
      if (url.includes('response=redirect')) return new Response(crx);
      return new Response('', { status: 404 });
    });
  };

  it('installs by link: hash checked, id checked, marked as a store install', async () => {
    store(makeCrx3(zipTree(mv3Tree({ version: '2.12.1' })), [key]), '2.12.1');
    const preview = value(await ext.prepareExtensionInstall({ kind: 'webstore', input: link }));
    expect(preview.extension).toMatchObject({ id, version: '2.12.1', source: 'webstore' });
    const info = value(await ext.commitExtensionInstall(preview.stagingId));
    expect(info.source).toBe('webstore');
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain('response=updatecheck');
    expect(urls[0]).toContain(`x=id%3D${id}%26v%3D0.0.0.0%26uc`);
    expect(urls[1]).toContain('response=redirect');
  });

  it('refuses a package that does not match the store’s hash', async () => {
    store(makeCrx3(zipTree(mv3Tree()), [key]), '1.0', { hash: 'f'.repeat(64) });
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'webstore', input: id }))).toBe(
      'download_failed',
    );
  });

  it('refuses a package signed for another id', async () => {
    store(makeCrx3(zipTree(mv3Tree()), [makeRsaKey()]), '1.0');
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'webstore', input: id }))).toBe(
      'bad_package',
    );
    expect(await fs.readdir(staging)).toEqual([]);
  });

  it('says not_found for an id the store does not know, and bad_input for nonsense', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          `<gupdate protocol="2.0"><app appid="${id}" status="error-unknownApplication"/></gupdate>`,
        ),
    );
    expect(errorOf(await ext.prepareExtensionInstall({ kind: 'webstore', input: id }))).toBe(
      'not_found',
    );
    expect(
      errorOf(await ext.prepareExtensionInstall({ kind: 'webstore', input: 'https://evil.test/' })),
    ).toBe('bad_input');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still installs when the update check is down, relying on the signature alone', async () => {
    const crx = makeCrx3(zipTree(mv3Tree()), [key]);
    fetchMock.mockImplementation(async (url) =>
      url.includes('response=updatecheck')
        ? new Response('down', { status: 503 })
        : new Response(crx),
    );
    expect(
      value(await ext.prepareExtensionInstall({ kind: 'webstore', input: id })).extension.id,
    ).toBe(id);
  });

  it('updates: null when current; a staged preview when newer, installed only on commit, enabled flag kept', async () => {
    store(makeCrx3(zipTree(mv3Tree({ version: '1.0' })), [key]), '1.0');
    const installed = value(
      await ext.commitExtensionInstall(
        value(await ext.prepareExtensionInstall({ kind: 'webstore', input: id })).stagingId,
      ),
    );
    await ext.setExtensionEnabled(installed.id, false);

    store(makeCrx3(zipTree(mv3Tree({ version: '1.0' })), [key]), '1.0', { current: '1.0' });
    expect(value(await ext.updateExtension(id))).toBeNull();
    expect(await fs.readdir(staging)).toEqual([]);

    store(
      makeCrx3(
        zipTree(mv3Tree({ version: '1.1', manifest: { permissions: ['storage', 'cookies'] } })),
        [key],
      ),
      '1.1',
    );
    const preview = value(await ext.updateExtension(id));
    // What the new version asks for, before anything of it is installed.
    expect(preview).toMatchObject({
      replaces: '1.0',
      extension: { id, version: '1.1', permissions: ['storage', 'cookies'] },
      unsupported: ['cookies'],
    });
    expect(await fs.readdir(join(root, id))).toEqual(['1.0']);

    const updated = value(await ext.commitExtensionInstall(preview?.stagingId ?? ''));
    expect(updated).toMatchObject({ id, version: '1.1', enabled: false, source: 'webstore' });
    expect(await fs.readdir(join(root, id))).toEqual(['1.1']);
    expect(await fs.readdir(staging)).toEqual([]);
  });

  it('updates only store installs', async () => {
    const info = await installZip(mv3Tree());
    expect(errorOf(await ext.updateExtension(info.id))).toBe('bad_input');
    expect(errorOf(await ext.updateExtension(id))).toBe('not_found');
  });
});

describe('start-up', () => {
  it('purges staging older than an hour, keeps fresher', async () => {
    await writeTree(join(staging, 'old'), { 'pkg/manifest.json': '{}' });
    await writeTree(join(staging, 'fresh'), { 'pkg/manifest.json': '{}' });
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    await fs.utimes(join(staging, 'old'), twoHoursAgo, twoHoursAgo);
    await ext.initExtensions();
    expect(await fs.readdir(staging)).toEqual(['fresh']);
  });

  it('sweeps folders the registry does not point at', async () => {
    const info = await installZip(mv3Tree());
    await writeTree(join(root, info.id, '0.9'), { 'manifest.json': '{}' });
    await writeTree(join(root, 'ponmlkjihgfedcbaponmlkjihgfedcba', '1.0'), {
      'manifest.json': '{}',
    });
    await writeTree(join(root, 'not-an-id'), { 'keep.txt': 'left alone' });
    ext.resetExtensionsForTests();
    await ext.initExtensions();
    expect(await fs.readdir(join(root, info.id))).toEqual(['1.0']);
    await expect(fs.access(join(root, 'ponmlkjihgfedcbaponmlkjihgfedcba'))).rejects.toThrow();
    await fs.access(join(root, 'not-an-id', 'keep.txt'));
    expect(await ext.listExtensions()).toHaveLength(1);
  });

  it('re-patches folders made by an older shim version into a new folder, same id', async () => {
    const info = await installZip(mv3Tree());
    const file = await registry();
    const [entry] = file.extensions as Array<Record<string, unknown>>;
    await fs.writeFile(
      join(root, 'registry.json'),
      JSON.stringify({ ...file, extensions: [{ ...entry, patchVersion: 0 }] }),
    );
    ext.resetExtensionsForTests();
    await ext.initExtensions();

    const folder = `1.0_p${PATCH_VERSION}`;
    expect((await registry()).extensions).toMatchObject([
      { id: info.id, dir: `${info.id}/${folder}`, patchVersion: PATCH_VERSION, enabled: true },
    ]);
    expect(await fs.readdir(join(root, info.id))).toEqual([folder]);
    const manifest = await readJson(join(root, info.id, folder, 'manifest.json'));
    expect(idOf(Buffer.from(manifest.key as string, 'base64'))).toBe(info.id);
    expect(manifest.content_scripts).toHaveLength(2);
  });

  it('sets an unreadable registry aside and touches nothing on disk', async () => {
    const info = await installZip(mv3Tree());
    await fs.writeFile(join(root, 'registry.json'), '{ broken');
    ext.resetExtensionsForTests();
    expect(await ext.listExtensions()).toEqual([]);
    await fs.access(join(root, info.id, '1.0', 'manifest.json'));
    expect((await fs.readdir(root)).some((f) => f.startsWith('registry.json.broken-'))).toBe(true);
  });

  it('drops registry entries it cannot read, keeping the rest', async () => {
    const info = await installZip(mv3Tree());
    const file = await registry();
    await fs.writeFile(
      join(root, 'registry.json'),
      JSON.stringify({
        ...file,
        extensions: [
          ...(file.extensions as unknown[]),
          { id: 'ponmlkjihgfedcbaponmlkjihgfedcba', dir: '../../escape' },
        ],
      }),
    );
    ext.resetExtensionsForTests();
    expect((await ext.listExtensions()).map((e) => e.id)).toEqual([info.id]);
  });
});
