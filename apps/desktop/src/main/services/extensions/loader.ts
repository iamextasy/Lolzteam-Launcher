import { resolve } from 'node:path';
import type { AdapterLogger } from '@adapter-contract';
import type { Extension, Session } from 'electron';
import log from 'electron-log/main';

/** The part of a `Session` the loader drives — small enough for a test to fake. */
export type ExtensionSession = Pick<
  Session,
  'loadExtension' | 'removeExtension' | 'getExtension' | 'getAllExtensions'
>;

/** An extension a session should have, and the folder to load it from. */
export interface LoadTarget {
  readonly id: string;
  readonly path: string;
}

type Logger = Pick<AdapterLogger, 'info' | 'warn'>;

const fallbackLog: Logger = {
  info: (msg, meta) => log.info(msg, ...(meta === undefined ? [] : [meta])),
  warn: (msg, meta) => log.warn(msg, ...(meta === undefined ? [] : [meta])),
};

/** Electron upper-cases a Windows drive letter in `Extension.path`; compare the way the platform does. */
const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

/**
 * Loads the launcher's extensions into account sessions and keeps every session it has seen in step with the
 * registry. Extensions do not survive a restart in Electron, and each `persist:` partition needs its own load.
 * All work goes through one queue: two windows of one account opening together must not load an extension twice.
 *
 * A session is held from the login that unloads it ({@link unload}) until that login's window closes
 * ({@link release}) or the login gives up without one ({@link abandon}). When the last hold goes, so do the
 * extensions: nothing of the launcher's keeps running as an account no window of which is open.
 */
export class SessionLoader {
  private readonly sessions = new Map<ExtensionSession, Logger>();
  /** Logins under way and windows open, per session. */
  private readonly holds = new Map<ExtensionSession, number>();
  /**
   * Unloaded and not yet loaded again: the caller is clearing the session's storage in between, and a live change
   * must not load an extension into it then — the wipe would kill that extension's freshly registered worker.
   */
  private readonly held = new Set<ExtensionSession>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    /** Read when the work runs, not when it is queued — the registry may change in between. */
    private readonly targets: () => readonly LoadTarget[],
    /** Whether a loaded extension is one of the launcher's (anything else in the session is left alone). */
    private readonly isOurs: (ext: Extension) => boolean,
  ) {}

  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Brings `ses` to the registry and remembers it for later changes. Never throws. */
  load(ses: ExtensionSession, logger: Logger = fallbackLog): Promise<void> {
    this.sessions.set(ses, logger);
    // A login whose unload found the extensions not started yet counted no hold; the session it loads is still held.
    if (!this.holds.get(ses)) this.holds.set(ses, 1);
    return this.serial(async () => {
      this.held.delete(ses);
      await this.sync(ses, logger);
    });
  }

  /**
   * A login starts: takes all of the launcher's extensions out of `ses` and holds it empty until the next `load`.
   * The login now holds the session — see {@link release} and {@link abandon}. Never throws.
   */
  unload(ses: ExtensionSession): Promise<void> {
    this.holds.set(ses, (this.holds.get(ses) ?? 0) + 1);
    const logger = this.sessions.get(ses) ?? fallbackLog;
    return this.serial(async () => {
      this.held.add(ses);
      for (const ext of this.ours(ses, logger)) this.remove(ses, ext, logger);
    });
  }

  /** The window a login opened has closed. Never throws. */
  release(ses: ExtensionSession): Promise<void> {
    return this.letGo(ses, false);
  }

  /**
   * The login that unloaded `ses` ended without a window — cancelled, or failed on the way. An open window of the
   * account gets its extensions back; with none open, nothing is left loaded. Never throws.
   */
  abandon(ses: ExtensionSession): Promise<void> {
    return this.letGo(ses, true);
  }

  private letGo(ses: ExtensionSession, endsLogin: boolean): Promise<void> {
    // A window of a session the loader never saw (not an account's) holds nothing.
    if (!this.holds.has(ses)) return Promise.resolve();
    this.holds.set(ses, Math.max(0, (this.holds.get(ses) ?? 0) - 1));
    return this.serial(async () => {
      if (endsLogin) this.held.delete(ses);
      const logger = this.sessions.get(ses) ?? fallbackLog;
      // Counted when the work runs: a login may have taken the session again meanwhile.
      if ((this.holds.get(ses) ?? 0) > 0) {
        // Back to what the open window had before this login unloaded it.
        if (endsLogin && this.sessions.has(ses)) await this.sync(ses, logger);
        return;
      }
      this.sessions.delete(ses);
      this.holds.delete(ses);
      this.held.delete(ses);
      for (const ext of this.ours(ses, logger)) this.remove(ses, ext, logger);
    });
  }

  /** Re-syncs every remembered session not held empty — after an install, update, removal, or a toggle. */
  refresh(): Promise<void> {
    return this.serial(async () => {
      for (const [ses, logger] of this.sessions) {
        if (!this.held.has(ses)) await this.sync(ses, logger);
      }
    });
  }

  /** Forgets every session (tests). */
  reset(): void {
    this.sessions.clear();
    this.holds.clear();
    this.held.clear();
    this.queue = Promise.resolve();
  }

  private ours(ses: ExtensionSession, logger: Logger): Extension[] {
    try {
      return ses.getAllExtensions().filter((ext) => this.isOurs(ext));
    } catch (err) {
      logger.warn('[extensions] could not list the session’s extensions', err);
      return [];
    }
  }

  private remove(ses: ExtensionSession, ext: Extension, logger: Logger): void {
    try {
      ses.removeExtension(ext.id);
    } catch (err) {
      logger.warn(`[extensions] could not unload ${ext.name} (${ext.id})`, err);
    }
  }

  private async sync(ses: ExtensionSession, logger: Logger): Promise<void> {
    const want = new Map(this.targets().map((t) => [t.id, t.path]));
    // Out first: disabled, removed, or loaded from a folder an update has since replaced.
    for (const ext of this.ours(ses, logger)) {
      const path = want.get(ext.id);
      if (path === undefined || !samePath(path, ext.path)) this.remove(ses, ext, logger);
    }
    for (const [id, path] of want) {
      try {
        if (ses.getExtension(id)) continue;
        const ext = await ses.loadExtension(path, { allowFileAccess: false });
        logger.info(`[extensions] loaded ${ext.name} ${ext.version} (${ext.id})`);
      } catch (err) {
        // One broken extension must not keep the others, or the window, from opening.
        logger.warn(`[extensions] could not load ${id}`, err);
      }
    }
  }
}
