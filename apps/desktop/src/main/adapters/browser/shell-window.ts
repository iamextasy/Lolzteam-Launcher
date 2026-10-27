import type { AdapterContext } from '@adapter-contract';
import { BrowserWindow, type Session, type WebContents, session } from 'electron';
import {
  abandonSessionExtensions,
  loadSessionExtensions,
  unloadSessionExtensions,
} from '../../services/extensions';
import { applyProxyToSession, clearProxyFromSession } from '../../services/proxy';
import { MAIN_COLORS } from '../../theme';
import { type BrowserShellOptions, createBrowserShell } from './browser-shell';
import type { InjectableCookie } from './extract';
import { guardSessionPermissions, isWebUrl } from './guards';

/** Extensions run in the accounts' own sessions and nowhere else: not the app's (auth, lzt) nor the default one. */
export const isAccountPartition = (partition: string): boolean =>
  partition.startsWith('persist:lzt-account-');

/**
 * Runs a login's session setup — the wipe, the proxy, the cookies — with the launcher's extensions out of the session
 * meanwhile: out before the wipe (a wipe under a registered extension worker kills it for the run), back in last, so
 * a worker starts with the proxy and the account's cookies already in place. A login that fails or is cancelled on
 * the way opens no window to hold the session, so it hands it back instead: an open window of the account keeps its
 * extensions, and with none open nothing is left running as the account.
 */
export const prepareAccountSession = async (
  partition: string,
  ctx: AdapterContext,
  prepare: (ses: Session) => Promise<void>,
): Promise<void> => {
  const ses = session.fromPartition(partition);
  if (!isAccountPartition(partition)) return prepare(ses);

  // Before any extension can run here: the window sets the same guard, but a cancelled login never opens one.
  guardSessionPermissions(ses, ctx.log);
  await unloadSessionExtensions(ses);
  let prepared = false;
  try {
    await prepare(ses);
    prepared = true;
  } finally {
    if (prepared && !ctx.abortSignal.aborted) await loadSessionExtensions(ses, ctx.log);
    // Checked again after the load: the adapter returns without a window on an abort that came meanwhile.
    if (!prepared || ctx.abortSignal.aborted) await abandonSessionExtensions(ses);
  }
};

export const injectCookies = (
  partition: string,
  cookies: InjectableCookie[],
  ctx: AdapterContext,
): Promise<void> =>
  prepareAccountSession(partition, ctx, async (ses) => {
    await ses.clearStorageData();

    if (ctx.proxy) {
      await applyProxyToSession(ses, ctx.proxy);
      ctx.log.info(`[browser] routing #${partition} via proxy ${ctx.proxy.host}:${ctx.proxy.port}`);
    } else {
      await clearProxyFromSession(ses);
    }

    for (const cookie of cookies) {
      try {
        await ses.cookies.set(cookie);
      } catch (err) {
        ctx.log.warn(`[browser] failed to set cookie ${cookie.name}`, err);
      }
    }
  });

/**
 * An account's browser window, `landingUrl` in its first tab. `plantBeforeScripts` and `onEachLoad` are the
 * adapter's hooks on that first tab only — where its landing page is; tabs the user opens later are left alone.
 */
export const openBrowserWindow = (
  partition: string,
  landingUrl: string,
  title: string,
  ctx: AdapterContext,
  opts?: Pick<BrowserShellOptions, 'emailPassword'> & {
    onEachLoad?: (site: WebContents) => void;
    plantBeforeScripts?: (site: WebContents) => Promise<void> | void;
  },
): { windowId: number } => {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: MAIN_COLORS.bg,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);

  const { siteView } = createBrowserShell(win, {
    partition,
    log: ctx.log,
    proxy: ctx.proxy,
    proxyTest: ctx.proxyTest,
    emailPassword: opts?.emailPassword,
  });
  if (opts?.plantBeforeScripts) {
    const ses = session.fromPartition(partition);
    let blocking = true;
    const unblock = () => {
      if (!blocking) return;
      blocking = false;
      ses.webRequest.onBeforeRequest(null);
    };
    // Session-wide, so every tab's scripts wait as well — for the landing page's first load, a moment.
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      // The site's scripts only: an extension's own files load from `chrome-extension://` meanwhile.
      callback({ cancel: blocking && details.resourceType === 'script' && isWebUrl(details.url) });
    });
    // The first tab closed before its page loaded: the other tabs must not go on without scripts.
    siteView.webContents.once('destroyed', unblock);
    siteView.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          await opts.plantBeforeScripts?.(siteView.webContents);
        } catch (err) {
          ctx.log.warn('[browser] pre-script injection failed', err);
        }
        unblock();
        if (!siteView.webContents.isDestroyed()) siteView.webContents.reload();
      })();
    });
    win.on('closed', unblock);
  } else if (opts?.onEachLoad) {
    siteView.webContents.on('did-finish-load', () => opts.onEachLoad?.(siteView.webContents));
  }
  siteView.webContents.loadURL(landingUrl).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log.warn(`[browser] loadURL failed: ${msg}`);
  });

  return { windowId: win.id };
};
