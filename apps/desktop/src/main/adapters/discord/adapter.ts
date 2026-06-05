import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails } from '@shared-types';
import { BrowserWindow, session } from 'electron';
import { applyProxyToSession, clearProxyFromSession } from '../../services/proxy';
import { MAIN_COLORS } from '../../theme';
import { failLogin as fail } from '../_shared/fail';
import { createBrowserShell } from '../browser/browser-shell';
import { extractDiscordToken } from './extract';

const LOGIN_URL = 'https://discord.com/login';
const APP_URL = 'https://discord.com/channels/@me';

const buildInjectionScript = (token: string): string => {
  const json = JSON.stringify(JSON.stringify(token));
  return `(() => {
    try {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      iframe.contentWindow.localStorage.setItem('token', ${json});
      iframe.remove();
      return true;
    } catch (e) {
      try {
        window.localStorage.setItem('token', ${json});
        return true;
      } catch (_) {
        return false;
      }
    }
  })()`;
};

const prepareSession = async (partition: string, ctx: AdapterContext): Promise<void> => {
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();

  if (ctx.proxy) {
    await applyProxyToSession(ses, ctx.proxy);
    ctx.log.info(`[discord] routing #${partition} via proxy ${ctx.proxy.host}:${ctx.proxy.port}`);
  } else {
    await clearProxyFromSession(ses);
  }
};

export const discordAdapter: ServiceAdapter = {
  id: 'discord',
  displayName: 'Discord',
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

    const token = extractDiscordToken(account);
    if (!token) {
      ctx.log.warn(`[discord] no token for #${account.itemId} (category=${account.categoryRaw})`);
      return fail('У этого аккаунта нет токена для входа в Discord', method);
    }

    const partition = `persist:lzt-account-${account.itemId}`;
    await prepareSession(partition, ctx);

    if (ctx.abortSignal.aborted) return fail('Вход отменён', method);

    ctx.onProgress?.({ step: 'injecting-token' });
    ctx.log.info(`[discord] opening Discord for #${account.itemId}`);

    const win = new BrowserWindow({
      width: 1180,
      height: 820,
      backgroundColor: MAIN_COLORS.bg,
      title: `${this.displayName} — ${account.title}`,
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
    const site = siteView.webContents;

    let injected = false;
    site.on('did-finish-load', () => {
      if (injected) return;
      injected = true;
      site
        .executeJavaScript(buildInjectionScript(token), true)
        .then((ok: unknown) => {
          ctx.log.info(`[discord] token injected (${ok ? 'ok' : 'fallback failed'}), entering app`);
          ctx.onProgress?.({ step: 'launching-browser' });
          return site.loadURL(APP_URL);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log.warn(`[discord] token injection failed: ${msg}`);
        });
    });

    site.loadURL(LOGIN_URL).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.warn(`[discord] loadURL failed: ${msg}`);
    });

    return {
      ok: true,
      method,
      windowId: win.id,
      message: `Discord открыт под аккаунтом ${account.title}`,
    };
  },
};
