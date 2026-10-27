import { IPC_CHANNELS } from '@shared-ipc';
import type { ActionDraft, BrowserExtensionInfo, ExtensionResult } from '@shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Synthetic ids: 32 letters a–p, as Chrome spells them. */
const ID = 'abcdefghijklmnopabcdefghijklmnop';

const info = (over: Partial<BrowserExtensionInfo> = {}): BrowserExtensionInfo => ({
  id: ID,
  name: 'Example Helper',
  version: '1.2.3',
  description: '',
  enabled: true,
  source: 'webstore',
  manifestVersion: 3,
  permissions: [],
  hostPermissions: [],
  hasPopup: true,
  hasOptions: false,
  icon: null,
  installedAt: 1,
  ...over,
});

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  recorded: [] as ActionDraft[],
  sent: [] as [string, unknown][],
  changeListeners: [] as ((list: unknown[]) => void)[],
  guarded: vi.fn(),
  ext: {
    listExtensions: vi.fn(),
    prepareExtensionInstall: vi.fn(),
    commitExtensionInstall: vi.fn(),
    discardExtensionInstall: vi.fn(),
    removeExtension: vi.fn(),
    setExtensionEnabled: vi.fn(),
    updateExtension: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload?: unknown) => unknown) =>
      h.handlers.set(channel, fn),
  },
}));

vi.mock('../../adapters/browser/guards', () => ({ guardExtensionBackgrounds: h.guarded }));

vi.mock('../../window/main-window', () => ({
  getMainWindow: () => ({
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => h.sent.push([channel, payload]),
    },
  }),
}));

// The journal as `handleAction` and `logAction` use it, written to an array instead of a file.
vi.mock('../../services/action-log', () => {
  const outcomeOf = (r: unknown) =>
    (r as { ok?: unknown })?.ok === false
      ? { status: 'fail' as const, detail: (r as { message?: string }).message ?? null }
      : { status: 'ok' as const, detail: null };
  return {
    outcomeOf,
    classifyError: () => ({ status: 'fail' as const, detail: null }),
    recordAction: (draft: ActionDraft) => h.recorded.push(draft),
    logAction: async (
      action: string,
      meta: { target?: string | null; detail?: (result: unknown) => string | null },
      run: () => Promise<unknown>,
    ) => {
      const result = await run();
      const outcome = outcomeOf(result);
      h.recorded.push({
        action,
        durationMs: 0,
        target: meta.target,
        status: outcome.status,
        detail: outcome.detail ?? meta.detail?.(result) ?? null,
      });
      return result;
    },
  };
});

vi.mock('../../services/extensions', () => ({
  ...h.ext,
  onExtensionsChange: (cb: (list: unknown[]) => void) => {
    h.changeListeners.push(cb);
    return () => undefined;
  },
}));

const { registerExtensionsIpc, toInstallSource } = await import('../extensions');
registerExtensionsIpc();

const call = <T>(channel: string, payload?: unknown): Promise<T> => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return Promise.resolve(handler({}, payload) as T);
};

const ok = <T>(value: T): ExtensionResult<T> => ({ ok: true, value });

beforeEach(() => {
  h.recorded.length = 0;
  h.sent.length = 0;
  for (const fn of Object.values(h.ext)) fn.mockReset();
  h.ext.listExtensions.mockResolvedValue([info()]);
});

describe('toInstallSource', () => {
  it('rebuilds a source from its own fields and nothing else', () => {
    expect(toInstallSource({ kind: 'webstore', input: ID, extra: 1 })).toEqual({
      kind: 'webstore',
      input: ID,
    });
    expect(toInstallSource({ kind: 'file', path: '/tmp/x.crx', input: 'y' })).toEqual({
      kind: 'file',
      path: '/tmp/x.crx',
    });
    expect(toInstallSource({ kind: 'folder', path: '/tmp/ext' })).toEqual({
      kind: 'folder',
      path: '/tmp/ext',
    });
  });

  it('refuses anything that is not one of the three shapes', () => {
    for (const raw of [
      null,
      undefined,
      'webstore',
      {},
      { kind: 'webstore' },
      { kind: 'webstore', input: 42 },
      { kind: 'file', input: '/tmp/x.crx' },
      { kind: 'url', path: 'https://example.test/x.crx' },
    ]) {
      expect(toInstallSource(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe('registerExtensionsIpc', () => {
  it('answers every extensions channel and guards extension background pages', () => {
    for (const channel of [
      IPC_CHANNELS.EXTENSIONS_LIST,
      IPC_CHANNELS.EXTENSIONS_PREPARE,
      IPC_CHANNELS.EXTENSIONS_COMMIT,
      IPC_CHANNELS.EXTENSIONS_DISCARD,
      IPC_CHANNELS.EXTENSIONS_REMOVE,
      IPC_CHANNELS.EXTENSIONS_SET_ENABLED,
      IPC_CHANNELS.EXTENSIONS_UPDATE,
    ]) {
      expect(h.handlers.has(channel), channel).toBe(true);
    }
    expect(h.guarded).toHaveBeenCalledTimes(1);
  });

  it('tells the main window about every change, with the whole list', () => {
    const list = [info(), info({ id: 'ponmlkjihgfedcbaponmlkjihgfedcba', enabled: false })];
    for (const cb of h.changeListeners) cb(list);
    expect(h.sent).toEqual([[IPC_CHANNELS.EXTENSIONS_CHANGED, list]]);
  });

  it('hands the installer a clean source, and nothing for a malformed one', async () => {
    h.ext.prepareExtensionInstall.mockResolvedValue({ ok: false, error: 'not_found' });
    await call(IPC_CHANNELS.EXTENSIONS_PREPARE, { kind: 'webstore', input: ID, path: '/etc' });
    expect(h.ext.prepareExtensionInstall).toHaveBeenCalledWith({ kind: 'webstore', input: ID });

    h.ext.prepareExtensionInstall.mockClear();
    const res = await call(IPC_CHANNELS.EXTENSIONS_PREPARE, { kind: 'file', path: 7 });
    expect(res).toEqual({ ok: false, error: 'bad_input' });
    expect(h.ext.prepareExtensionInstall).not.toHaveBeenCalled();
    // A preview is not an install: nothing in the journal yet.
    expect(h.recorded).toEqual([]);
  });

  it('journals an install under the name the preview showed', async () => {
    const { enabled: _e, installedAt: _i, ...extension } = info();
    h.ext.prepareExtensionInstall.mockResolvedValue(
      ok({ stagingId: 'stg-1', extension, replaces: null, unsupported: [] }),
    );
    h.ext.commitExtensionInstall.mockResolvedValue(ok(info()));

    await call(IPC_CHANNELS.EXTENSIONS_PREPARE, { kind: 'webstore', input: ID });
    await call(IPC_CHANNELS.EXTENSIONS_COMMIT, 'stg-1');

    expect(h.ext.commitExtensionInstall).toHaveBeenCalledWith('stg-1');
    expect(h.recorded).toMatchObject([
      { action: 'extension.install', status: 'ok', target: 'Example Helper', detail: '1.2.3' },
    ]);
  });

  it('turns an extension on and off under two journal actions', async () => {
    await call(IPC_CHANNELS.EXTENSIONS_LIST);
    h.ext.setExtensionEnabled.mockResolvedValue(ok(info({ enabled: false })));

    await call(IPC_CHANNELS.EXTENSIONS_SET_ENABLED, { id: ID, enabled: false });
    await call(IPC_CHANNELS.EXTENSIONS_SET_ENABLED, { id: ID, enabled: true });

    expect(h.ext.setExtensionEnabled.mock.calls).toEqual([
      [ID, false],
      [ID, true],
    ]);
    expect(h.recorded).toMatchObject([
      { action: 'extension.disable', target: 'Example Helper' },
      { action: 'extension.enable', target: 'Example Helper' },
    ]);
  });

  it('refuses a toggle that is not a boolean, rather than reading it as one', async () => {
    const res = await call(IPC_CHANNELS.EXTENSIONS_SET_ENABLED, { id: ID, enabled: 'false' });
    expect(res).toEqual({ ok: false, error: 'bad_input' });
    expect(h.ext.setExtensionEnabled).not.toHaveBeenCalled();
  });

  it('journals a removal by name, and its failure as a failure', async () => {
    await call(IPC_CHANNELS.EXTENSIONS_LIST);
    h.ext.removeExtension.mockResolvedValue({ ok: false, error: 'io', message: 'disk full' });

    await call(IPC_CHANNELS.EXTENSIONS_REMOVE, ID);

    expect(h.recorded).toMatchObject([
      { action: 'extension.remove', status: 'fail', target: 'Example Helper', detail: 'disk full' },
    ]);
  });

  it('journals no update check — only the update the user then agrees to, as an update', async () => {
    const { enabled: _e, installedAt: _i, ...extension } = info({ version: '1.3.0' });
    h.ext.updateExtension.mockResolvedValueOnce(ok(null));
    await call(IPC_CHANNELS.EXTENSIONS_UPDATE, ID);

    h.ext.updateExtension.mockResolvedValueOnce(
      ok({ stagingId: 'stg-2', extension, replaces: '1.2.3', unsupported: [] }),
    );
    expect(await call(IPC_CHANNELS.EXTENSIONS_UPDATE, ID)).toMatchObject({
      ok: true,
      value: { stagingId: 'stg-2', replaces: '1.2.3' },
    });
    expect(h.recorded).toEqual([]);

    h.ext.commitExtensionInstall.mockResolvedValue(ok(info({ version: '1.3.0' })));
    await call(IPC_CHANNELS.EXTENSIONS_COMMIT, 'stg-2');
    expect(h.ext.commitExtensionInstall).toHaveBeenCalledWith('stg-2');
    expect(h.recorded).toMatchObject([
      { action: 'extension.update', status: 'ok', target: 'Example Helper', detail: '1.3.0' },
    ]);
  });

  it('never passes a non-string id on', async () => {
    for (const channel of [
      IPC_CHANNELS.EXTENSIONS_COMMIT,
      IPC_CHANNELS.EXTENSIONS_REMOVE,
      IPC_CHANNELS.EXTENSIONS_UPDATE,
    ]) {
      expect(await call(channel, { id: ID }), channel).toEqual({ ok: false, error: 'bad_input' });
    }
    await call(IPC_CHANNELS.EXTENSIONS_DISCARD, 42);
    expect(h.ext.commitExtensionInstall).not.toHaveBeenCalled();
    expect(h.ext.removeExtension).not.toHaveBeenCalled();
    expect(h.ext.updateExtension).not.toHaveBeenCalled();
    expect(h.ext.discardExtensionInstall).not.toHaveBeenCalled();
  });
});
