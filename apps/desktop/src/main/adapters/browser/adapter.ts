import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails, ServiceId } from '@shared-types';
import { BrowserWindow, session } from 'electron';
import { applyProxyToSession, clearProxyFromSession } from '../../services/proxy';
import { MAIN_COLORS } from '../../theme';
import { failLogin as fail } from '../_shared/fail';
import { createBrowserShell } from './browser-shell';
import { type InjectableCookie, extractBrowserLogin } from './extract';

const injectCookies = async (
  partition: string,
  cookies: InjectableCookie[],
  ctx: AdapterContext,
): Promise<void> => {
  const ses = session.fromPartition(partition);
  // Start from a clean slate so a stale prior session can't shadow the cookies
  // we're about to write for the just-purchased account.
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
      // One bad cookie shouldn't abort the whole login — log and continue.
      ctx.log.warn(`[browser] failed to set cookie ${cookie.name}`, err);
    }
  }
};

const createBrowserAdapter = (id: ServiceId, displayName: string): ServiceAdapter => ({
  id,
  displayName,
  platforms: ['win32', 'darwin', 'linux'] as const,
  methods: ['web'] as const,

  async probe(method: LoginMethod): Promise<ProbeResult> {
    if (method !== 'web') {
      return { available: false, reason: 'Поддерживается только вход через браузер' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'web') return fail('Поддерживается только вход через браузер', method);
    if (ctx.abortSignal.aborted) return fail('Вход отменён', method);

    const data = extractBrowserLogin(account);
    if (!data) {
      const secrets = (account.secrets ?? {}) as Record<string, unknown>;
      const cookieKeys = Object.keys(secrets).filter(
        (k) => k === 'cookies' || k.endsWith('_cookies') || k === 'cookieKey',
      );
      ctx.log.warn(
        `[browser] no cookies for #${account.itemId} (category=${account.categoryRaw}); ` +
          `cookie-ish keys present: ${cookieKeys.length ? cookieKeys.join(', ') : 'none'}`,
      );
      return fail('У этого аккаунта нет cookie для входа через браузер', method);
    }

    // A persistent, per-account partition keeps each account's session isolated
    // and lets the buyer stay logged in across launches.
    const partition = `persist:lzt-account-${account.itemId}`;

    ctx.onProgress?.({ step: 'injecting-cookies' });
    ctx.log.info(`[browser] injecting ${data.cookies.length} cookie(s) for #${account.itemId}`);
    await injectCookies(partition, data.cookies, ctx);

    if (ctx.abortSignal.aborted) return fail('Вход отменён', method);

    ctx.onProgress?.({ step: 'launching-browser' });
    ctx.log.info(`[browser] opening ${data.landingUrl}`);

    const win = new BrowserWindow({
      width: 1180,
      height: 820,
      backgroundColor: MAIN_COLORS.bg,
      title: `${displayName} — ${account.title}`,
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
    });
    siteView.webContents.loadURL(data.landingUrl).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.warn(`[browser] loadURL failed: ${msg}`);
    });

    return {
      ok: true,
      method,
      windowId: win.id,
      message: `${displayName} открыт под аккаунтом ${account.title}`,
    };
  },
});

export const tiktokAdapter = createBrowserAdapter('tiktok', 'TikTok');
export const instagramAdapter = createBrowserAdapter('instagram', 'Instagram');
