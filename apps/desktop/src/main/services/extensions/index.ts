import { join } from 'node:path';
import type { AdapterLogger } from '@adapter-contract';
import type {
  BrowserExtensionInfo,
  ExtensionInstallPreview,
  ExtensionInstallSource,
  ExtensionPage,
  ExtensionResult,
} from '@shared-types';
import { type Session, app } from 'electron';
import log from 'electron-log/main';
import { ExtensionError } from './errors';
import { ExtensionManager } from './installer';

export { UNSUPPORTED_PERMISSIONS } from './manifest';

const listeners = new Set<(list: BrowserExtensionInfo[]) => void>();

const emit = (list: BrowserExtensionInfo[]): void => {
  for (const cb of listeners) {
    try {
      cb(list);
    } catch (err) {
      log.error('[extensions] a change listener threw', err);
    }
  }
};

let manager: ExtensionManager | null = null;
let starting: Promise<ExtensionManager> | null = null;

/** The manager, initialised once; a failed start is retried on the next call. */
const ready = (): Promise<ExtensionManager> => {
  starting ??= (async () => {
    const m = new ExtensionManager({
      root: join(app.getPath('userData'), 'extensions'),
      onChange: emit,
    });
    await m.init();
    manager = m;
    return m;
  })().catch((err: unknown) => {
    starting = null;
    throw err;
  });
  return starting;
};

const attempt = async <T>(
  what: string,
  fn: (m: ExtensionManager) => Promise<T>,
): Promise<ExtensionResult<T>> => {
  try {
    return { ok: true, value: await fn(await ready()) };
  } catch (err) {
    if (err instanceof ExtensionError) {
      log.warn(`[extensions] ${what}: ${err.code} — ${err.message}`);
      return { ok: false, error: err.code, message: err.message };
    }
    log.error(`[extensions] ${what} failed`, err);
    return { ok: false, error: 'io', message: err instanceof Error ? err.message : String(err) };
  }
};

/** Idempotent. Reads the registry under `<userData>/extensions`, purges stale staging, re-patches outdated folders. */
export const initExtensions = async (): Promise<void> => {
  await ready();
};

export const listExtensions = async (): Promise<BrowserExtensionInfo[]> => {
  try {
    return (await ready()).list();
  } catch (err) {
    log.error('[extensions] could not start', err);
    return [];
  }
};

/** Downloads or reads the package, unpacks and patches it into staging: what the user is then asked to approve. */
export const prepareExtensionInstall = (
  source: ExtensionInstallSource,
): Promise<ExtensionResult<ExtensionInstallPreview>> =>
  attempt(`prepare (${source?.kind})`, (m) => m.prepare(source));

/**
 * Installs what was staged (replacing the same id) and loads it into every live session: enabled, or for a staged
 * update as the extension was.
 */
export const commitExtensionInstall = (
  stagingId: string,
): Promise<ExtensionResult<BrowserExtensionInfo>> => attempt('install', (m) => m.commit(stagingId));

export const discardExtensionInstall = async (stagingId: string): Promise<void> => {
  const result = await attempt('discard', (m) => m.discard(stagingId));
  if (!result.ok) log.warn(`[extensions] discarding ${stagingId} failed`);
};

/** Unloads it from every live session and deletes its files. */
export const removeExtension = (id: string): Promise<ExtensionResult<null>> =>
  attempt(`remove ${id}`, async (m) => {
    await m.remove(id);
    return null;
  });

export const setExtensionEnabled = (
  id: string,
  enabled: boolean,
): Promise<ExtensionResult<BrowserExtensionInfo>> =>
  attempt(`${enabled ? 'enable' : 'disable'} ${id}`, (m) => m.setEnabled(id, enabled === true));

/**
 * Store installs only: stages the newer version and answers what it asks for, as {@link prepareExtensionInstall}
 * does — {@link commitExtensionInstall} installs it, keeping the extension on or off. `null` when the installed
 * version is already the newest.
 */
export const updateExtension = (
  id: string,
): Promise<ExtensionResult<ExtensionInstallPreview | null>> =>
  attempt(`update ${id}`, (m) => m.update(id));

/** Called with the whole list (enabled or not) after every install, update, removal and toggle. */
export const onExtensionsChange = (cb: (list: BrowserExtensionInfo[]) => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/**
 * Before ses.clearStorageData(): unload our extensions so their service workers are not wiped while registered.
 * The login now holds the session until {@link releaseSessionExtensions} (its window closed) or
 * {@link abandonSessionExtensions} (it ended without one).
 */
export const unloadSessionExtensions = async (ses: Session): Promise<void> => {
  try {
    await (await ready()).unloadSession(ses);
  } catch (err) {
    log.warn('[extensions] could not unload a session’s extensions', err);
  }
};

/**
 * After clearing (and proxy/cookies): load every enabled extension not yet loaded into this session; remember the
 * session so later enable/disable/remove/update are applied to it live. Never throws (logs and skips a broken
 * extension).
 */
export const loadSessionExtensions = async (ses: Session, logger: AdapterLogger): Promise<void> => {
  try {
    await (await ready()).loadSession(ses, logger);
  } catch (err) {
    logger.warn('[extensions] could not load extensions into the session', err);
  }
};

/**
 * A window of the account closed. The last one out takes the launcher's extensions out of the session and forgets
 * it: nothing keeps running — waking on alarms, making requests — as an account with no window open. Never throws;
 * a window of any other session is a no-op.
 */
export const releaseSessionExtensions = async (ses: Session): Promise<void> => {
  // No manager, nothing was ever loaded: closing a window is no reason to start one.
  await manager?.releaseSession(ses);
};

/**
 * The login that called {@link unloadSessionExtensions} ended without a window — cancelled, or failed on the way. An
 * open window of the account gets its extensions back; with none open, nothing is left running. Never throws.
 */
export const abandonSessionExtensions = async (ses: Session): Promise<void> => {
  await manager?.abandonSession(ses);
};

/** chrome-extension://<id>/<page> for an enabled extension, or null. */
export const extensionPageUrl = async (id: string, page: ExtensionPage): Promise<string | null> => {
  try {
    return (await ready()).pageUrl(id, page);
  } catch {
    return null;
  }
};

/** Whether `url` is a chrome-extension:// URL of an installed & enabled extension (sync, from an in-memory cache kept fresh by the registry). */
export const isEnabledExtensionUrl = (url: string): boolean => manager?.isEnabledUrl(url) ?? false;

/** Test seam: forgets the manager, its sessions and every listener. */
export const resetExtensionsForTests = (): void => {
  manager?.loader.reset();
  manager = null;
  starting = null;
  listeners.clear();
};
