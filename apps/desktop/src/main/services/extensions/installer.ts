import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type {
  BrowserExtensionInfo,
  ExtensionInstallPreview,
  ExtensionInstallSource,
  ExtensionPage,
} from '@shared-types';
import log from 'electron-log/main';
import { isCrx, parseCrx } from './crx';
import { ExtensionError, fail } from './errors';
import { copyFolder, exists, freeName, isInside, moveDir, removeDir } from './files';
import { type ExtensionSession, type LoadTarget, SessionLoader } from './loader';
import { MANIFEST_FILE, type ManifestInfo, readManifest, unsupportedPermissions } from './manifest';
import { PATCH_VERSION, patchExtension, restoreOriginalManifest } from './patch';
import {
  REGISTRY_FILE,
  type RegistryEntry,
  readRegistry,
  toExtensionInfo,
  writeRegistry,
} from './registry';
import {
  EXTENSION_ID,
  type Fetcher,
  MAX_CRX_BYTES,
  checkWebstoreUpdate,
  downloadWebstoreCrx,
  isNewer,
  parseWebstoreInput,
} from './webstore';
import { extractZip, isZip } from './zip';

/** Unpacked-and-patched packages waiting for the user's yes, under the extensions root. */
export const STAGING_DIR = '.staging';

/** A staged package nobody committed or discarded is dropped after this. */
export const STAGING_TTL_MS = 60 * 60_000;

type Logger = Parameters<SessionLoader['load']>[1];

interface Staged {
  /** `.staging/<uuid>`: removed whatever happens to the install. */
  readonly dir: string;
  /** The patched extension — the staging folder's `pkg`, or the one folder a zip wrapped it in. */
  readonly root: string;
  readonly extension: ExtensionInstallPreview['extension'];
  readonly popupPage: string | null;
  readonly optionsPage: string | null;
  readonly generatedKey: string | null;
  readonly createdAt: number;
  /** A store update of an installed extension: committing it keeps the extension's on/off switch where it is. */
  readonly update?: true;
}

/** What a source turned into once unpacked into the staging folder. */
interface Unpacked {
  readonly publicKey: Buffer | null;
  /** The store id asked for; the package must turn out to be it. */
  readonly expectedId: string | null;
  readonly source: BrowserExtensionInfo['source'];
}

export interface ManagerOptions {
  /** `<userData>/extensions`. */
  readonly root: string;
  /** The store's network; Electron's `net.fetch` when left out. */
  readonly fetcher?: Fetcher;
  /** Called with the whole list after every change. */
  readonly onChange?: (list: BrowserExtensionInfo[]) => void;
}

/** Cleanup never fails an operation: Windows may hold a file a moment longer, and the next start sweeps leftovers. */
const tidy = (path: string): Promise<void> =>
  removeDir(path).catch((err) => log.warn(`[extensions] could not delete ${path}`, err));

const absolutePath = (path: unknown, what: string): string => {
  if (typeof path !== 'string' || !isAbsolute(path))
    fail('bad_input', `${what} is not an absolute path`);
  return path;
};

/** The extension's root inside an unpacked package: the package itself, or the one folder it was zipped in. */
const packageRoot = async (pkg: string): Promise<string> => {
  if (await exists(join(pkg, MANIFEST_FILE))) return pkg;
  const entries = (await fs.readdir(pkg, { withFileTypes: true }).catch(() => [])).filter(
    (d) => d.name !== '__MACOSX',
  );
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only?.isDirectory() && (await exists(join(pkg, only.name, MANIFEST_FILE)))) {
    return join(pkg, only.name);
  }
  return fail('bad_manifest', 'the package has no manifest.json');
};

/**
 * Installed extensions: the registry on disk, its in-memory copy, staging, and the sessions they are loaded into.
 * Every change to the registry runs through one queue; staging runs outside it, so a 70 MB download does not hold
 * up a toggle.
 */
export class ExtensionManager {
  private entries: RegistryEntry[] = [];
  /** Kept beside `entries` for the synchronous URL check the window guards make. */
  private enabledIds = new Set<string>();
  private readonly staged = new Map<string, Staged>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly loader: SessionLoader;

  constructor(private readonly options: ManagerOptions) {
    this.loader = new SessionLoader(
      () => this.targets(),
      (ext) => isInside(this.root, ext.path),
    );
  }

  private get root(): string {
    return this.options.root;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private find(id: string): RegistryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  private abs(dir: string): string {
    return join(this.root, ...dir.split('/'));
  }

  private setEntries(next: RegistryEntry[]): void {
    this.entries = next;
    this.enabledIds = new Set(next.filter((e) => e.enabled).map((e) => e.id));
  }

  private targets(): LoadTarget[] {
    return this.entries.filter((e) => e.enabled).map((e) => ({ id: e.id, path: this.abs(e.dir) }));
  }

  private emit(): void {
    try {
      this.options.onChange?.(this.list());
    } catch (err) {
      log.error('[extensions] a change listener threw', err);
    }
  }

  /** Reads the registry, drops stale staging, re-patches folders an older shim version made, sweeps orphans. */
  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await this.purgeStaging();

    let sweep = true;
    try {
      const { entries, dropped } = await readRegistry(this.root);
      if (dropped) {
        log.warn(
          `[extensions] ${dropped} unreadable registry entr${dropped === 1 ? 'y' : 'ies'} ignored`,
        );
        sweep = false;
      }
      this.setEntries(entries);
    } catch (err) {
      // Kept aside rather than overwritten by the next install, and nothing on disk is swept this run.
      log.error('[extensions] the registry is unreadable; starting with none installed', err);
      const aside = join(this.root, `${REGISTRY_FILE}.broken-${Date.now()}`);
      await fs.rename(join(this.root, REGISTRY_FILE), aside).catch(() => undefined);
      this.setEntries([]);
      sweep = false;
    }

    for (const entry of [...this.entries]) {
      if (entry.patchVersion === PATCH_VERSION) continue;
      await this.repatch(entry).catch((err) =>
        log.warn(
          `[extensions] could not re-patch ${entry.name} (${entry.id}); keeping its folder`,
          err,
        ),
      );
    }
    if (sweep) await this.sweep();
  }

  private async purgeStaging(): Promise<void> {
    const dir = join(this.root, STAGING_DIR);
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (this.staged.has(name)) continue;
      const stat = await fs.stat(join(dir, name)).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > STAGING_TTL_MS) await tidy(join(dir, name));
    }
  }

  /** Folders no registry entry points at: what a crash between "moved in" and "written down" leaves behind. */
  private async sweep(): Promise<void> {
    for (const name of await fs.readdir(this.root).catch(() => [] as string[])) {
      if (!EXTENSION_ID.test(name)) continue;
      const entry = this.find(name);
      if (!entry) {
        await tidy(join(this.root, name));
        continue;
      }
      const keep = entry.dir.split('/')[1];
      for (const sub of await fs.readdir(join(this.root, name)).catch(() => [] as string[])) {
        if (sub !== keep) await tidy(join(this.root, name, sub));
      }
    }
  }

  /** Drops staged packages left hanging (a dialog closed without a word) for over an hour. */
  private async pruneStaged(): Promise<void> {
    for (const [id, staged] of this.staged) {
      if (Date.now() - staged.createdAt <= STAGING_TTL_MS) continue;
      this.staged.delete(id);
      await tidy(staged.dir);
    }
  }

  /** A key this launcher made up for a keyless package of the same name: its next version keeps the id. */
  private generatedKeyFor(name: string): string | null {
    return this.entries.find((e) => e.generatedKey && e.name === name)?.generatedKey ?? null;
  }

  /** Unpacks a source into a fresh staging folder, checks it, and patches it. The folder is gone on failure. */
  private async stage(unpack: (pkg: string) => Promise<Unpacked>): Promise<Staged> {
    const dir = join(this.root, STAGING_DIR, randomUUID());
    await fs.mkdir(dir, { recursive: true });
    try {
      const input = await unpack(join(dir, 'pkg'));
      const root = await packageRoot(join(dir, 'pkg'));
      const carriedKey = await restoreOriginalManifest(root);
      const manifest = await readManifest(root);
      const patched = await patchExtension(root, {
        publicKey: input.publicKey,
        carriedKey,
        reuseKey: input.publicKey ? null : this.generatedKeyFor(manifest.name),
      });
      if (input.expectedId && patched.id !== input.expectedId) {
        fail('bad_package', `the package is ${patched.id}, not ${input.expectedId}`);
      }
      const previous = this.find(patched.id);
      return {
        dir,
        root,
        extension: this.describe(manifest, patched.id, input.source),
        popupPage: manifest.popupPage,
        optionsPage: manifest.optionsPage,
        generatedKey:
          patched.generatedKey ?? (carriedKey ? (previous?.generatedKey ?? null) : null),
        createdAt: Date.now(),
      };
    } catch (err) {
      await tidy(dir);
      throw err;
    }
  }

  private describe(
    manifest: ManifestInfo,
    id: string,
    source: BrowserExtensionInfo['source'],
  ): ExtensionInstallPreview['extension'] {
    return {
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      source,
      manifestVersion: manifest.manifestVersion,
      permissions: manifest.permissions,
      hostPermissions: manifest.hostPermissions,
      hasPopup: manifest.popupPage !== null,
      hasOptions: manifest.optionsPage !== null,
      icon: manifest.icon,
    };
  }

  /** Unpacks a store package; the store's own hash is checked when it gives one. */
  private fromStore(id: string, sha256: string | null): (pkg: string) => Promise<Unpacked> {
    return async (pkg) => {
      const crx = parseCrx(
        await downloadWebstoreCrx(id, { sha256, fetcher: this.options.fetcher }),
      );
      if (crx.id !== id) fail('bad_package', `the store sent a package for ${crx.id ?? 'no id'}`);
      await extractZip(crx.zip, pkg);
      return { publicKey: crx.publicKey, expectedId: id, source: 'webstore' };
    };
  }

  private async fromFile(path: unknown, pkg: string): Promise<Unpacked> {
    const file = absolutePath(path, 'the package');
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) fail('bad_input', 'the package file is not there');
    if (stat.size > MAX_CRX_BYTES) fail('too_large', `the package is ${stat.size} bytes`);
    const buf = await fs.readFile(file);
    if (isCrx(buf)) {
      const crx = parseCrx(buf);
      await extractZip(crx.zip, pkg);
      return { publicKey: crx.publicKey, expectedId: null, source: 'file' };
    }
    if (!isZip(buf)) fail('bad_package', 'the file is neither a .crx nor a .zip');
    await extractZip(buf, pkg);
    return { publicKey: null, expectedId: null, source: 'file' };
  }

  /** Copied first: the patch never touches the user's own folder. */
  private async fromFolder(path: unknown, pkg: string): Promise<Unpacked> {
    const folder = absolutePath(path, 'the folder');
    const stat = await fs.stat(folder).catch(() => null);
    if (!stat?.isDirectory()) fail('bad_input', 'the folder is not there');
    if (isInside(folder, this.root)) fail('bad_input', 'the folder holds the launcher’s own data');
    // Before copying anything: a wrongly picked home folder would otherwise be copied up to the size cap.
    if (!(await exists(join(folder, MANIFEST_FILE)))) {
      fail('bad_manifest', 'the folder has no manifest.json');
    }
    await copyFolder(folder, pkg);
    return { publicKey: null, expectedId: null, source: 'file' };
  }

  /**
   * Moves a staged package into `<id>/<folder>`, writes the registry, brings live sessions over, then deletes the
   * folder it replaced. Runs inside the queue.
   */
  private async install(
    staged: Staged,
    opts: { enabled: boolean; folder?: string },
  ): Promise<RegistryEntry> {
    const { extension } = staged;
    const previous = this.find(extension.id);
    const parent = join(this.root, extension.id);
    await fs.mkdir(parent, { recursive: true });
    const folder = await freeName(parent, opts.folder ?? extension.version);
    const target = join(parent, folder);
    await moveDir(staged.root, target);

    const entry: RegistryEntry = {
      ...extension,
      enabled: opts.enabled,
      // A replaced extension keeps its place in the list.
      installedAt: previous?.installedAt ?? Date.now(),
      dir: `${extension.id}/${folder}`,
      popupPage: staged.popupPage,
      optionsPage: staged.optionsPage,
      patchVersion: PATCH_VERSION,
      generatedKey: staged.generatedKey,
    };
    const next = previous
      ? this.entries.map((e) => (e.id === entry.id ? entry : e))
      : [...this.entries, entry];
    try {
      await writeRegistry(this.root, next);
    } catch (err) {
      await tidy(target);
      throw err;
    }
    this.setEntries(next);
    await this.loader.refresh();
    if (previous) await tidy(this.abs(previous.dir));
    this.emit();
    return entry;
  }

  /** A folder patched by an older shim version, patched again from its original manifest into a new folder. */
  private async repatch(entry: RegistryEntry): Promise<void> {
    const staged = await this.stage(async (pkg) => {
      await copyFolder(this.abs(entry.dir), pkg);
      return { publicKey: null, expectedId: entry.id, source: entry.source };
    });
    try {
      await this.install(staged, {
        enabled: entry.enabled,
        folder: `${staged.extension.version}_p${PATCH_VERSION}`,
      });
      log.info(
        `[extensions] re-patched ${entry.name} (${entry.id}) to shim version ${PATCH_VERSION}`,
      );
    } finally {
      await tidy(staged.dir);
    }
  }

  list(): BrowserExtensionInfo[] {
    return this.entries.map(toExtensionInfo);
  }

  async prepare(source: ExtensionInstallSource): Promise<ExtensionInstallPreview> {
    await this.pruneStaged();
    let unpack: (pkg: string) => Promise<Unpacked>;
    switch (source?.kind) {
      case 'webstore': {
        const id = typeof source.input === 'string' ? parseWebstoreInput(source.input) : null;
        if (!id) fail('bad_input', 'not a Chrome Web Store link or extension id');
        unpack = this.fromStore(id, await this.storeHash(id));
        break;
      }
      case 'file':
        unpack = (pkg) => this.fromFile(source.path, pkg);
        break;
      case 'folder':
        unpack = (pkg) => this.fromFolder(source.path, pkg);
        break;
      default:
        return fail('bad_input', 'unknown install source');
    }

    return this.offer(await this.stage(unpack));
  }

  /** Keeps a staged package for the user's answer, and says what it would install. */
  private offer(staged: Staged): ExtensionInstallPreview {
    const stagingId = basename(staged.dir);
    this.staged.set(stagingId, staged);
    return {
      stagingId,
      extension: staged.extension,
      replaces: this.find(staged.extension.id)?.version ?? null,
      unsupported: unsupportedPermissions(staged.extension.permissions),
    };
  }

  /** The store's hash of its newest package, best effort: without it the CRX signature still has to hold. */
  private async storeHash(id: string): Promise<string | null> {
    try {
      const check = await checkWebstoreUpdate(id, '0.0.0.0', this.options.fetcher);
      if (check.status === 'not_found') fail('not_found', `the store has no extension ${id}`);
      return check.status === 'update' ? check.sha256 : null;
    } catch (err) {
      if (err instanceof ExtensionError && err.code !== 'download_failed') throw err;
      log.warn(`[extensions] update check for ${id} failed; downloading without a hash`, err);
      return null;
    }
  }

  async commit(stagingId: string): Promise<BrowserExtensionInfo> {
    const staged = this.staged.get(stagingId);
    if (!staged) fail('not_found', 'nothing is staged under this id (expired, or already used)');
    this.staged.delete(stagingId);
    return this.serial(async () => {
      try {
        // An update leaves a switched-off extension off; anything else the user just chose to install runs.
        const enabled = staged.update ? (this.find(staged.extension.id)?.enabled ?? true) : true;
        return toExtensionInfo(await this.install(staged, { enabled }));
      } finally {
        await tidy(staged.dir);
      }
    });
  }

  async discard(stagingId: string): Promise<void> {
    const staged = this.staged.get(stagingId);
    if (!staged) return;
    this.staged.delete(stagingId);
    await tidy(staged.dir);
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const entry = this.find(id);
      if (!entry) fail('not_found', `extension ${id} is not installed`);
      const next = this.entries.filter((e) => e.id !== id);
      await writeRegistry(this.root, next);
      this.setEntries(next);
      await this.loader.refresh();
      await tidy(join(this.root, entry.id));
      this.emit();
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<BrowserExtensionInfo> {
    return this.serial(async () => {
      const entry = this.find(id);
      if (!entry) fail('not_found', `extension ${id} is not installed`);
      if (entry.enabled === enabled) return toExtensionInfo(entry);
      const updated: RegistryEntry = { ...entry, enabled };
      const next = this.entries.map((e) => (e.id === id ? updated : e));
      await writeRegistry(this.root, next);
      this.setEntries(next);
      await this.loader.refresh();
      this.emit();
      return toExtensionInfo(updated);
    });
  }

  /**
   * Stages the store's newer version, `null` when there is none. Like any install it waits for the user's yes
   * ({@link commit}): a new version may ask for more than the one they agreed to.
   */
  async update(id: string): Promise<ExtensionInstallPreview | null> {
    await this.pruneStaged();
    const entry = this.find(id);
    if (!entry) fail('not_found', `extension ${id} is not installed`);
    if (entry.source !== 'webstore')
      fail('bad_input', 'only Chrome Web Store installs can be updated');

    const check = await checkWebstoreUpdate(id, entry.version, this.options.fetcher);
    if (check.status === 'not_found') fail('not_found', `the store no longer has ${id}`);
    if (check.status === 'noupdate' || !isNewer(check.version, entry.version)) return null;

    const staged = await this.stage(this.fromStore(id, check.sha256));
    if (!isNewer(staged.extension.version, entry.version)) {
      await tidy(staged.dir);
      return null;
    }
    return this.offer({ ...staged, update: true });
  }

  /** `chrome-extension://<id>/<page>` of an enabled extension that has that page. */
  pageUrl(id: string, page: ExtensionPage): string | null {
    const entry = this.find(id);
    if (!entry?.enabled) return null;
    const ref = page === 'popup' ? entry.popupPage : page === 'options' ? entry.optionsPage : null;
    if (!ref) return null;
    const base = `chrome-extension://${entry.id}/`;
    const url = new URL(ref, base).href;
    return url.startsWith(base) ? url : null;
  }

  isEnabledUrl(url: string): boolean {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'chrome-extension:' && this.enabledIds.has(parsed.hostname);
    } catch {
      return false;
    }
  }

  loadSession(ses: ExtensionSession, logger: Logger): Promise<void> {
    return this.loader.load(ses, logger);
  }

  unloadSession(ses: ExtensionSession): Promise<void> {
    return this.loader.unload(ses);
  }

  releaseSession(ses: ExtensionSession): Promise<void> {
    return this.loader.release(ses);
  }

  abandonSession(ses: ExtensionSession): Promise<void> {
    return this.loader.abandon(ses);
  }
}
