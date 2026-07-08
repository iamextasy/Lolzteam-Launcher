import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails } from '@shared-types';
import { failLogin as fail } from '../_shared/fail';
import { injectCookies, openBrowserWindow } from '../browser/shell-window';
import { computeConnectCacheHdr, dpapiProtect } from './dpapi';
import { extractSteamCreds } from './extract';
import { findSteamPaths } from './paths';
import { killSteamProcesses, waitForSteamExit } from './process';
import { setAutoLoginUser } from './registry';
import { type SessionError, acquireRefreshToken, acquireWebSession } from './session';
import { steam64ToSteam32 } from './steamid';
import { mergeConfigVdf, mergeLocalVdf, mergeLoginUsersVdf, writeLocalConfigVdf } from './vdf';
import { webCookiesToInjectable } from './web-cookies';

type Acquire<D> = (p: {
  login: string;
  password: string;
  sharedSecret: string | null;
  emailCode?: string;
}) => Promise<{ ok: true; data: D } | { ok: false; error: SessionError }>;

const resolveSession = async <D>(
  account: AccountDetails,
  ctx: AdapterContext,
  creds: { login: string; password: string; sharedSecret: string | null },
  acquire: Acquire<D>,
): Promise<{ ok: true; data: D } | { ok: false; failMessage: string }> => {
  let session = await acquire(creds);
  if (session.ok) return session;

  switch (session.error.kind) {
    case 'needs-email-code': {
      if (!ctx.fetchEmailCode) return { ok: false, failMessage: 'Аккаунт требует код с почты' };
      ctx.onProgress?.({ step: 'awaiting-email-code' });
      ctx.log.info('[steam] fetching email code from market');
      ctx.onProgress?.({ step: 'fetching-email-code' });
      const code = await ctx.fetchEmailCode(account.itemId);
      if (!code)
        return { ok: false, failMessage: 'Не удалось получить код с почты — попробуйте ещё раз' };
      ctx.log.info('[steam] retrying with email code');
      ctx.onProgress?.({ step: 'acquiring-token', detail: 'с кодом из почты' });
      session = await acquire({ ...creds, emailCode: code });
      if (!session.ok)
        return { ok: false, failMessage: `Steam отверг код с почты: ${errMsg(session.error)}` };
      return session;
    }
    case 'needs-totp': {
      // The account uses a Steam Guard authenticator but the mafile wasn't in
      // the item data. Fetch it on demand (this cancels the item's guarantee,
      // so we only do it now that we know TOTP is required) and retry.
      if (!ctx.fetchSteamMafile)
        return { ok: false, failMessage: 'Аккаунт требует код Steam Guard (mafile недоступен)' };
      ctx.log.info('[steam] fetching mafile for TOTP guard');
      const sharedSecret = await ctx.fetchSteamMafile(account.itemId);
      if (!sharedSecret)
        return {
          ok: false,
          failMessage: 'Не удалось получить mafile для Steam Guard — попробуйте ещё раз',
        };
      ctx.log.info('[steam] retrying with mafile TOTP');
      ctx.onProgress?.({ step: 'acquiring-token', detail: 'с кодом Steam Guard' });
      session = await acquire({ ...creds, sharedSecret });
      if (!session.ok)
        return { ok: false, failMessage: `Steam отверг код Steam Guard: ${errMsg(session.error)}` };
      return session;
    }
    case 'needs-device-confirm':
      return {
        ok: false,
        failMessage: 'Аккаунт ждёт подтверждения на мобильном устройстве Steam Guard',
      };
    case 'needs-email-confirm':
      return { ok: false, failMessage: 'Аккаунт ждёт подтверждения по ссылке из письма' };
    case 'bad-credentials':
      return { ok: false, failMessage: `Steam отверг логин/пароль: ${session.error.message}` };
    default:
      return { ok: false, failMessage: `Ошибка входа в Steam: ${errMsg(session.error)}` };
  }
};

const errMsg = (error: SessionError): string =>
  error.kind === 'unknown' || error.kind === 'bad-credentials' ? error.message : error.kind;

export const steamAdapter: ServiceAdapter = {
  id: 'steam',
  displayName: 'Steam',
  platforms: ['win32'] as const,
  methods: ['native', 'web'] as const,

  async probe(method: LoginMethod): Promise<ProbeResult> {
    if (method === 'web') return { available: true };
    if (method !== 'native') {
      return { available: false, reason: 'Only native login supported' };
    }
    if (process.platform !== 'win32') {
      return { available: false, reason: 'Steam adapter requires Windows' };
    }
    const paths = await findSteamPaths();
    if (!paths) {
      return { available: false, reason: 'Steam not found in registry' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method === 'web') return loginViaBrowser(account, ctx);
    if (method !== 'native') return fail('Only native login supported', method);
    return loginNative(account, ctx);
  },
};

const loginViaBrowser = async (
  account: AccountDetails,
  ctx: AdapterContext,
): Promise<LoginResult> => {
  if (ctx.abortSignal.aborted) return fail('Вход отменён', 'web');

  const creds = extractSteamCreds(account);
  if (!creds) return fail('У этого аккаунта нет логина/пароля в данных lzt.market', 'web');

  ctx.onProgress?.({ step: 'acquiring-token' });
  ctx.log.info(`[steam] acquiring web session for item #${account.itemId}`);
  const session = await resolveSession(account, ctx, creds, acquireWebSession);
  if (!session.ok) return fail(session.failMessage, 'web');

  const cookies = webCookiesToInjectable(session.data.cookies);
  if (cookies.length === 0) return fail('Steam не вернул web-куки для входа', 'web');

  if (ctx.abortSignal.aborted) return fail('Вход отменён', 'web');

  const partition = `persist:lzt-account-${account.itemId}`;
  ctx.onProgress?.({ step: 'injecting-cookies' });
  ctx.log.info(`[steam] injecting ${cookies.length} web cookie(s) for #${account.itemId}`);
  await injectCookies(partition, cookies, ctx);

  if (ctx.abortSignal.aborted) return fail('Вход отменён', 'web');

  ctx.onProgress?.({ step: 'launching-browser' });
  const landingUrl = 'https://steamcommunity.com/my';
  ctx.log.info(`[steam] opening ${landingUrl}`);
  const { windowId } = openBrowserWindow(partition, landingUrl, `Steam — ${account.title}`, ctx);

  return {
    ok: true,
    method: 'web',
    windowId,
    message: `Steam открыт в браузере под аккаунтом ${account.title}`,
  };
};

const loginNative = async (account: AccountDetails, ctx: AdapterContext): Promise<LoginResult> => {
  if (process.platform !== 'win32') return fail('Steam-адаптер работает только на Windows');

  const paths = await findSteamPaths();
  if (!paths) return fail('Steam не найден в системе (проверьте установку)');

  const creds = extractSteamCreds(account);
  if (!creds) return fail('У этого аккаунта нет логина/пароля в данных lzt.market');

  ctx.onProgress?.({ step: 'acquiring-token' });
  ctx.log.info(`[steam] acquiring refresh token for item #${account.itemId}`);
  const resolved = await resolveSession(account, ctx, creds, acquireRefreshToken);
  if (!resolved.ok) return fail(resolved.failMessage);
  const session = resolved;

  const { refreshToken, steamId, accountName } = session.data;
  const login = accountName || creds.login;
  const steamId32 = steam64ToSteam32(steamId);

  ctx.onProgress?.({ step: 'killing-steam' });
  ctx.log.info('[steam] killing Steam processes');
  await killSteamProcesses();
  await waitForSteamExit(5000);

  const userConfigDir = join(paths.steamDir, 'userdata', steamId32, 'config');
  const steamConfigDir = join(paths.steamDir, 'config');
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return fail('LOCALAPPDATA не определён');
  const localSteamDir = join(localAppData, 'Steam');

  ctx.onProgress?.({ step: 'writing-vdf' });
  ctx.log.info('[steam] merging VDF files');
  await writeLocalConfigVdf(
    join(userConfigDir, 'localconfig.vdf'),
    ctx.settings?.steamInvisible ?? false,
  );
  await mergeConfigVdf(join(steamConfigDir, 'config.vdf'), login, steamId);
  await mergeLoginUsersVdf(join(steamConfigDir, 'loginusers.vdf'), login, steamId);

  ctx.onProgress?.({ step: 'encrypting-token' });
  ctx.log.info('[steam] encrypting refresh token via DPAPI');
  let encryptedHex: string;
  try {
    encryptedHex = await dpapiProtect(
      Buffer.from(refreshToken, 'utf8'),
      Buffer.from(login, 'utf8'),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Не удалось зашифровать токен через DPAPI: ${msg}`);
  }

  const hdr = computeConnectCacheHdr(login);
  await mergeLocalVdf(join(localSteamDir, 'local.vdf'), hdr, encryptedHex);

  ctx.log.info('[steam] setting AutoLoginUser in registry');
  try {
    await setAutoLoginUser(login);
  } catch (err) {
    ctx.log.warn('[steam] failed to update registry', err);
  }

  const autoAppId =
    ctx.settings?.steamAutoLaunchGame && /^\d+$/.test(ctx.settings.steamAutoLaunchAppId ?? '')
      ? ctx.settings.steamAutoLaunchAppId
      : null;
  const launchTarget = autoAppId ? `steam://rungameid/${autoAppId}` : 'steam://0';

  ctx.onProgress?.({ step: 'launching-steam' });
  ctx.log.info(`[steam] launching via ${launchTarget}`);
  const child = spawn('cmd', ['/c', 'start', '', launchTarget], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  child.unref();

  return {
    ok: true,
    method: 'native',
    launchedPid: child.pid,
    message: `Steam запущен под аккаунтом ${login}`,
  };
};
