import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { API_SHIM_JS, CONTENT_SHIM_JS, serviceWorkerWrapper } from '../shims';

/** What Electron 33 gives an MV3 worker: `storage.sync` present but broken, `tabs` partial, the rest missing. */
const electronChrome = (manifest: Record<string, unknown> = {}) => {
  const local = { get: vi.fn(), set: vi.fn(), QUOTA_BYTES: 10_485_760 };
  const brokenSync = { get: vi.fn(() => undefined) };
  const query = vi.fn();
  const alarms = { create: vi.fn() };
  return {
    local,
    brokenSync,
    query,
    alarms,
    chrome: {
      storage: { local, sync: brokenSync, managed: { get: vi.fn() } },
      runtime: {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        getManifest: () => ({
          manifest_version: 3,
          permissions: ['storage', 'cookies'],
          host_permissions: ['https://example.test/*'],
          options_ui: { page: 'options.html' },
          ...manifest,
        }),
        getURL: (p: string) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${p}`,
        onMessage: { addListener: vi.fn() },
      },
      tabs: { query, sendMessage: vi.fn() },
      alarms,
      // biome-ignore lint/suspicious/noExplicitAny: the shim writes whole untyped chrome.* namespaces into this object
    } as Record<string, any>,
  };
};

const run = (code: string, globals: Record<string, unknown>): void => {
  runInNewContext(code, globals);
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('API shim', () => {
  it('maps storage.sync to local and makes managed an empty read-only area', async () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    expect(env.chrome.storage.sync).toBe(env.local);
    expect(await env.chrome.storage.managed.get(null)).toEqual({});
    const cb = vi.fn();
    env.chrome.storage.managed.get('policy', cb);
    expect(cb).not.toHaveBeenCalled();
    await tick();
    expect(cb).toHaveBeenCalledWith({});
  });

  it('defines what is missing, so startup code that registers listeners survives', async () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    const { chrome } = env;
    // What SIH's background does first, and what killed its whole startup on stock Electron 33.
    expect(() => {
      chrome.windows.onBoundsChanged.addListener(() => {});
      chrome.notifications.onClicked.addListener(() => {});
      chrome.contextMenus.onClicked.addListener(() => {});
      chrome.cookies.onChanged.addListener(() => {});
      chrome.webNavigation.onCompleted.addListener(() => {});
      chrome.tabs.onUpdated.addListener(() => {});
      chrome.permissions.onAdded.addListener(() => {});
      chrome.commands.onCommand.addListener(() => {});
      chrome.runtime.onInstalled.addListener(() => {});
    }).not.toThrow();
    expect(chrome.windows.onBoundsChanged.hasListener(() => {})).toBe(false);
    expect(await chrome.cookies.getAll({ domain: 'example.test' })).toEqual([]);
    expect(await chrome.cookies.get({ url: 'https://example.test', name: 'x' })).toBeNull();
    expect(await chrome.windows.getAll()).toEqual([]);
    expect((await chrome.windows.getCurrent()).id).toBe(-1);
    expect(await chrome.notifications.create('n1', { type: 'basic' })).toBe('n1');
    expect(await chrome.notifications.create({ type: 'basic' })).toMatch(/^lzt-/);
    expect(await chrome.offscreen.hasDocument()).toBe(false);
    await expect(chrome.offscreen.createDocument({ url: 'x.html' })).resolves.toBeUndefined();
  });

  it('answers through the callback (asynchronously) as well as the promise', async () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    const cb = vi.fn();
    const promise = env.chrome.cookies.getAll({}, cb);
    expect(cb).not.toHaveBeenCalled();
    await promise;
    await tick();
    expect(cb).toHaveBeenCalledWith([]);
  });

  it('leaves working APIs alone and only fills holes in partial ones', () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    expect(env.chrome.tabs.query).toBe(env.query);
    expect(env.chrome.alarms).toBe(env.alarms);
    expect(typeof env.chrome.tabs.create).toBe('function');
    expect(typeof env.chrome.tabs.sendMessage).toBe('function');
  });

  it('returns a context menu id synchronously, as Chrome does', () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    expect(env.chrome.contextMenus.create({ id: 'price', title: 'Price' })).toBe('price');
    expect(typeof env.chrome.contextMenus.create({ title: 'no id' })).toBe('number');
  });

  it('answers permission checks from what the manifest declared', async () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    const { permissions } = env.chrome;
    expect(await permissions.contains({ permissions: ['cookies'] })).toBe(true);
    expect(await permissions.contains({ permissions: ['downloads'] })).toBe(false);
    expect(await permissions.contains({ origins: ['https://example.test/*'] })).toBe(true);
    expect(await permissions.contains({ origins: ['https://other.test/*'] })).toBe(false);
    expect(await permissions.getAll()).toEqual({
      permissions: ['storage', 'cookies'],
      origins: ['https://example.test/*'],
    });
    const all = electronChrome({ host_permissions: ['<all_urls>'] });
    run(API_SHIM_JS, { chrome: all.chrome });
    expect(await all.chrome.permissions.contains({ origins: ['https://other.test/*'] })).toBe(true);
  });

  it('stubs only the action namespace of the manifest’s version', () => {
    const mv3 = electronChrome();
    run(API_SHIM_JS, { chrome: mv3.chrome });
    expect(mv3.chrome.action).toBeDefined();
    expect(mv3.chrome.browserAction).toBeUndefined();

    const mv2 = electronChrome({ manifest_version: 2, browser_action: {} });
    run(API_SHIM_JS, { chrome: mv2.chrome });
    expect(mv2.chrome.browserAction).toBeDefined();
    expect(mv2.chrome.pageAction).toBeUndefined();
    expect(mv2.chrome.action).toBeUndefined();
  });

  it('opens pages through window.open where there is a window', () => {
    const env = electronChrome();
    const open = vi.fn();
    run(API_SHIM_JS, {
      chrome: env.chrome,
      open,
      URL,
      location: { href: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/html/popup.html' },
    });
    env.chrome.tabs.create({ url: 'options.html' });
    expect(open).toHaveBeenCalledWith(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/html/options.html',
      '_blank',
    );
    env.chrome.windows.create({
      url: ['https://example.test/a', 'javascript:void 0', 'file:///etc'],
    });
    expect(open).toHaveBeenCalledWith('https://example.test/a', '_blank');
    expect(open).toHaveBeenCalledTimes(2);
    env.chrome.runtime.openOptionsPage();
    expect(open).toHaveBeenLastCalledWith(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html',
      '_blank',
    );
  });

  it('survives running twice, a missing chrome, and a chrome without storage', () => {
    const env = electronChrome();
    run(API_SHIM_JS, { chrome: env.chrome });
    const windows = env.chrome.windows;
    run(API_SHIM_JS, { chrome: env.chrome });
    expect(env.chrome.windows).toBe(windows);
    expect(() => run(API_SHIM_JS, {})).not.toThrow();
    expect(() => run(API_SHIM_JS, { chrome: { runtime: {} } })).not.toThrow();
  });

  it('is strict-mode code with nothing a module would choke on', () => {
    expect(API_SHIM_JS).toContain("'use strict'");
    expect(API_SHIM_JS).not.toMatch(/^\s*(import|export)\s/m);
  });
});

describe('content-script shim', () => {
  it('touches storage and nothing else', () => {
    const env = electronChrome();
    run(CONTENT_SHIM_JS, { chrome: env.chrome });
    expect(env.chrome.storage.sync).toBe(env.local);
    expect(env.chrome.windows).toBeUndefined();
    expect(env.chrome.notifications).toBeUndefined();
  });
});

describe('serviceWorkerWrapper', () => {
  it('imports the shim, then the original, relative to the wrapper', () => {
    const importScripts = vi.fn();
    run(serviceWorkerWrapper('service-worker.js', 'lzt-compat/shim.js', false), { importScripts });
    expect(importScripts.mock.calls).toEqual([['/lzt-compat/shim.js'], ['./service-worker.js']]);
  });

  it('escapes odd file names into the URL', () => {
    const importScripts = vi.fn();
    run(serviceWorkerWrapper('my "worker".js', 'lzt-compat/shim.js', false), { importScripts });
    expect(importScripts.mock.calls[1]).toEqual(['./my%20%22worker%22.js']);
    expect(serviceWorkerWrapper('w.js', 'lzt-compat/shim.js', true)).toMatch(
      /import "\/lzt-compat\/shim\.js";\nimport "\.\/w\.js";\n$/,
    );
  });
});
