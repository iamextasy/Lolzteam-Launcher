import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterLogger } from '@adapter-contract';
import type { BrowserNavState, ProxyTestResult } from '@shared-ipc';
import { IPC_CHANNELS } from '@shared-ipc';
import type { ProxyEntry } from '@shared-types';
import { type BrowserWindow, WebContentsView, clipboard, ipcMain, shell } from 'electron';
import { testProxy } from '../../services/proxy';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const TOOLBAR_H = 48;

interface ShellController {
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  go: (url: string) => void;
  copyUrl: () => void;
  openExternal: () => void;
  expand: () => void;
  collapse: () => void;
  proxyRetest: () => Promise<ProxyTestResult>;
}

const controllers = new Map<number, ShellController>();
let handlersWired = false;

const wireHandlers = (): void => {
  if (handlersWired) return;
  handlersWired = true;
  const get = (id: number): ShellController | undefined => controllers.get(id);
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_BACK, (e) => get(e.sender.id)?.back());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_FORWARD, (e) => get(e.sender.id)?.forward());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_RELOAD, (e) => get(e.sender.id)?.reload());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_STOP, (e) => get(e.sender.id)?.stop());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_GO, (e, url: string) => get(e.sender.id)?.go(url));
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_COPY_URL, (e) => get(e.sender.id)?.copyUrl());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL, (e) => get(e.sender.id)?.openExternal());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_EXPAND, (e) => get(e.sender.id)?.expand());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_COLLAPSE, (e) => get(e.sender.id)?.collapse());
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST, (e) => {
    const ctl = get(e.sender.id);
    if (!ctl) return { ok: false, message: 'toolbar gone' } satisfies ProxyTestResult;
    return ctl.proxyRetest();
  });
};

// Turn raw address-bar input into a safe URL. Only http/https are allowed;
// anything that looks like a bare domain gets https://, everything else becomes
// a Google search. file:/javascript: and friends are rejected.
const normalizeAddress = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;

  // A scheme we don't trust (e.g. file:, javascript:) — treat as a search.
  const hasUnknownScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const looksLikeDomain = !hasUnknownScheme && /\.[^\s.]+$/.test(value) && !/\s/.test(value);

  if (looksLikeDomain) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
};

const buildProxyQuery = (proxy: ProxyEntry, proxyTest?: { ip: string; ms: number }): string => {
  const params = new URLSearchParams({
    proxy: '1',
    label: proxy.label ?? '',
    host: proxy.host,
    port: String(proxy.port),
    ms: proxyTest ? String(proxyTest.ms) : '',
  });
  return params.toString();
};

const loadToolbar = (view: WebContentsView, query: string): void => {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    const suffix = query ? `?${query}` : '';
    void view.webContents.loadURL(`${devServerUrl}/toolbar/index.html${suffix}`);
  } else {
    void view.webContents.loadFile(join(__dirname, '../renderer/toolbar/index.html'), {
      search: query,
    });
  }
};

export const createBrowserShell = (
  win: BrowserWindow,
  opts: {
    partition: string;
    log: AdapterLogger;
    proxy?: ProxyEntry;
    proxyTest?: { ip: string; ms: number };
  },
): { siteView: WebContentsView } => {
  wireHandlers();

  const siteView = new WebContentsView({
    webPreferences: {
      partition: opts.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const toolbarView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/toolbar.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Transparent so the toolbar can expand over the site (for the proxy menu)
  // while only its 48px bar paints solid; the rest stays click-through-dimmed
  // by the renderer's own backdrop.
  toolbarView.setBackgroundColor('#00000000');

  win.contentView.addChildView(siteView);
  win.contentView.addChildView(toolbarView);

  let expanded = false;

  const layout = (): void => {
    const { width, height } = win.getContentBounds();
    toolbarView.setBounds(
      expanded ? { x: 0, y: 0, width, height } : { x: 0, y: 0, width, height: TOOLBAR_H },
    );
    siteView.setBounds({ x: 0, y: TOOLBAR_H, width, height: Math.max(0, height - TOOLBAR_H) });
  };
  layout();

  const site = siteView.webContents;

  const pushState = (): void => {
    if (toolbarView.webContents.isDestroyed()) return;
    const state: BrowserNavState = {
      url: site.getURL(),
      canGoBack: site.navigationHistory.canGoBack(),
      canGoForward: site.navigationHistory.canGoForward(),
      isLoading: site.isLoading(),
      title: site.getTitle(),
    };
    toolbarView.webContents.send(IPC_CHANNELS.BROWSER_NAV_STATE, state);
  };

  site.on('did-navigate', pushState);
  site.on('did-navigate-in-page', pushState);
  site.on('did-start-loading', pushState);
  site.on('did-stop-loading', pushState);
  site.on('page-title-updated', pushState);

  const proxyRetest = (): Promise<ProxyTestResult> => {
    if (!opts.proxy) return Promise.resolve({ ok: false, message: 'no proxy' });
    return testProxy({
      host: opts.proxy.host,
      port: opts.proxy.port,
      username: opts.proxy.username,
      password: opts.proxy.password,
    });
  };

  controllers.set(toolbarView.webContents.id, {
    back: () => {
      if (site.navigationHistory.canGoBack()) site.navigationHistory.goBack();
    },
    forward: () => {
      if (site.navigationHistory.canGoForward()) site.navigationHistory.goForward();
    },
    reload: () => site.reload(),
    stop: () => site.stop(),
    go: (url) => {
      const target = normalizeAddress(url);
      if (target) {
        void site.loadURL(target).catch((err: unknown) => {
          opts.log.warn(`[browser-shell] go failed: ${String(err)}`);
        });
      }
    },
    copyUrl: () => clipboard.writeText(site.getURL()),
    openExternal: () => {
      const url = site.getURL();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    },
    expand: () => {
      expanded = true;
      layout();
    },
    collapse: () => {
      expanded = false;
      layout();
    },
    proxyRetest,
  });

  toolbarView.webContents.on('did-finish-load', pushState);
  loadToolbar(toolbarView, opts.proxy ? buildProxyQuery(opts.proxy, opts.proxyTest) : '');

  const onResize = (): void => layout();
  win.on('resize', onResize);

  win.on('closed', () => {
    win.off('resize', onResize);
    controllers.delete(toolbarView.webContents.id);
  });

  return { siteView };
};
