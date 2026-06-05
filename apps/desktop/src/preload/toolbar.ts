import { contextBridge, ipcRenderer } from 'electron';

const BROWSER_NAV_BACK = 'browser-nav:back';
const BROWSER_NAV_FORWARD = 'browser-nav:forward';
const BROWSER_NAV_RELOAD = 'browser-nav:reload';
const BROWSER_NAV_STOP = 'browser-nav:stop';
const BROWSER_NAV_GO = 'browser-nav:go';
const BROWSER_NAV_COPY_URL = 'browser-nav:copy-url';
const BROWSER_NAV_OPEN_EXTERNAL = 'browser-nav:open-external';
const BROWSER_NAV_EXPAND = 'browser-nav:expand';
const BROWSER_NAV_COLLAPSE = 'browser-nav:collapse';
const BROWSER_NAV_PROXY_RETEST = 'browser-nav:proxy-retest';
const BROWSER_NAV_STATE = 'browser-nav:state';

type RetestResult = { ok: true; ms: number; ip: string } | { ok: false; message: string };

interface NavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
}

const browserNav = {
  back: () => ipcRenderer.invoke(BROWSER_NAV_BACK),
  forward: () => ipcRenderer.invoke(BROWSER_NAV_FORWARD),
  reload: () => ipcRenderer.invoke(BROWSER_NAV_RELOAD),
  stop: () => ipcRenderer.invoke(BROWSER_NAV_STOP),
  go: (url: string) => ipcRenderer.invoke(BROWSER_NAV_GO, url),
  copyUrl: () => ipcRenderer.invoke(BROWSER_NAV_COPY_URL),
  openExternal: () => ipcRenderer.invoke(BROWSER_NAV_OPEN_EXTERNAL),
  expand: () => ipcRenderer.invoke(BROWSER_NAV_EXPAND),
  collapse: () => ipcRenderer.invoke(BROWSER_NAV_COLLAPSE),
  proxyRetest: (): Promise<RetestResult> => ipcRenderer.invoke(BROWSER_NAV_PROXY_RETEST),
  onState: (cb: (state: NavState) => void): (() => void) => {
    const listener = (_e: unknown, state: NavState): void => cb(state);
    ipcRenderer.on(BROWSER_NAV_STATE, listener);
    return () => ipcRenderer.off(BROWSER_NAV_STATE, listener);
  },
} as const;

export type BrowserNavApi = typeof browserNav;

contextBridge.exposeInMainWorld('browserNav', browserNav);
