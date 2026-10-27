import type { AdapterLogger } from '@adapter-contract';
import { IPC_CHANNELS } from '@shared-ipc';
import type {
  BrowserExtensionInfo,
  ExtensionInstallPreview,
  ExtensionInstallSource,
  ExtensionResult,
} from '@shared-types';
import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { guardExtensionBackgrounds } from '../adapters/browser/guards';
import { logAction } from '../services/action-log';
import {
  commitExtensionInstall,
  discardExtensionInstall,
  listExtensions,
  onExtensionsChange,
  prepareExtensionInstall,
  removeExtension,
  setExtensionEnabled,
  updateExtension,
} from '../services/extensions';
import { getMainWindow } from '../window/main-window';
import { handleAction } from './handle-action';

const extensionsLog: AdapterLogger = {
  debug: (m, meta) => (meta === undefined ? log.debug(m) : log.debug(m, meta)),
  info: (m, meta) => (meta === undefined ? log.info(m) : log.info(m, meta)),
  warn: (m, meta) => (meta === undefined ? log.warn(m) : log.warn(m, meta)),
  error: (m, meta) => (meta === undefined ? log.error(m) : log.error(m, meta)),
};

/** What the renderer sent, rebuilt from the fields a source has — nothing else of it reaches the installer. */
export const toInstallSource = (raw: unknown): ExtensionInstallSource | null => {
  if (raw === null || typeof raw !== 'object') return null;
  const { kind, input, path } = raw as { kind?: unknown; input?: unknown; path?: unknown };
  if (kind === 'webstore' && typeof input === 'string') return { kind, input };
  if ((kind === 'file' || kind === 'folder') && typeof path === 'string') return { kind, path };
  return null;
};

const badInput: ExtensionResult<never> = { ok: false, error: 'bad_input' };

/**
 * Names for the journal, which is written before the work and so cannot ask the result: the list as last seen, and
 * what each staging folder holds. A journal line reads «Удаление расширения · SIH», not a 32-letter id.
 */
let known: readonly BrowserExtensionInfo[] = [];
const staged = new Map<string, { readonly name: string; readonly update: boolean }>();

/** Remembers what a staged package is called, and whether installing it is an update, for the commit's line. */
const remember = (
  result: ExtensionResult<ExtensionInstallPreview | null>,
  update: boolean,
): void => {
  if (result.ok && result.value) {
    staged.set(result.value.stagingId, { name: result.value.extension.name, update });
  }
};

const nameOf = (id: unknown): string | null =>
  typeof id === 'string' ? (known.find((ext) => ext.id === id)?.name ?? id) : null;

export const registerExtensionsIpc = (): void => {
  guardExtensionBackgrounds(extensionsLog);

  onExtensionsChange((list) => {
    known = list;
    const win = getMainWindow();
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXTENSIONS_CHANGED, list);
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_LIST, async (): Promise<BrowserExtensionInfo[]> => {
    known = await listExtensions();
    return [...known];
  });

  /** Nothing is installed yet — a download and a look inside — so no journal line until the user agrees. */
  ipcMain.handle(
    IPC_CHANNELS.EXTENSIONS_PREPARE,
    async (_e, raw: unknown): Promise<ExtensionResult<ExtensionInstallPreview>> => {
      const source = toInstallSource(raw);
      if (!source) return badInput;
      const result = await prepareExtensionInstall(source);
      remember(result, false);
      return result;
    },
  );

  /** An install or an update, whichever the staged package was: the journal says which. */
  ipcMain.handle(
    IPC_CHANNELS.EXTENSIONS_COMMIT,
    async (_e, stagingId: unknown): Promise<ExtensionResult<BrowserExtensionInfo>> => {
      if (typeof stagingId !== 'string') return badInput;
      const what = staged.get(stagingId);
      staged.delete(stagingId);
      return logAction(
        what?.update ? 'extension.update' : 'extension.install',
        { target: what?.name ?? null, detail: (r) => (r.ok ? r.value.version : null) },
        () => commitExtensionInstall(stagingId),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_DISCARD, async (_e, stagingId: unknown): Promise<void> => {
    if (typeof stagingId !== 'string') return;
    staged.delete(stagingId);
    await discardExtensionInstall(stagingId);
  });

  handleAction(
    IPC_CHANNELS.EXTENSIONS_REMOVE,
    async (_e, id: unknown): Promise<ExtensionResult<null>> =>
      typeof id === 'string' ? removeExtension(id) : badInput,
    { action: 'extension.remove', target: nameOf },
  );

  /** Two journal lines rather than one with a flag: «включено» and «выключено» are what the viewer looks for. */
  ipcMain.handle(
    IPC_CHANNELS.EXTENSIONS_SET_ENABLED,
    async (_e, raw: unknown): Promise<ExtensionResult<BrowserExtensionInfo>> => {
      const { id, enabled } = (raw ?? {}) as { id?: unknown; enabled?: unknown };
      if (typeof id !== 'string' || typeof enabled !== 'boolean') return badInput;
      return logAction(
        enabled ? 'extension.enable' : 'extension.disable',
        { target: nameOf(id) },
        () => setExtensionEnabled(id, enabled),
      );
    },
  );

  /** A check and a staged package, like a prepare: the journal line comes with the commit the user agrees to. */
  ipcMain.handle(
    IPC_CHANNELS.EXTENSIONS_UPDATE,
    async (_e, id: unknown): Promise<ExtensionResult<ExtensionInstallPreview | null>> => {
      if (typeof id !== 'string') return badInput;
      const result = await updateExtension(id);
      remember(result, true);
      return result;
    },
  );
};
