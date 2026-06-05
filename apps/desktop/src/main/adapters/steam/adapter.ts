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
import { computeConnectCacheHdr, dpapiProtect } from './dpapi';
import { extractSteamCreds } from './extract';
import { findSteamPaths } from './paths';
import { killSteamProcesses, waitForSteamExit } from './process';
import { setAutoLoginUser } from './registry';
import { acquireRefreshToken } from './session';
import { steam64ToSteam32 } from './steamid';
import { mergeConfigVdf, mergeLocalVdf, mergeLoginUsersVdf, writeLocalConfigVdf } from './vdf';

export const steamAdapter: ServiceAdapter = {
  id: 'steam',
  displayName: 'Steam',
  platforms: ['win32'] as const,
  methods: ['native'] as const,

  async probe(method: LoginMethod): Promise<ProbeResult> {
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
    if (method !== 'native') return fail('Only native login supported', method);
    if (process.platform !== 'win32') return fail('Steam-адаптер работает только на Windows');

    const paths = await findSteamPaths();
    if (!paths) return fail('Steam не найден в системе (проверьте установку)');

    const creds = extractSteamCreds(account);
    if (!creds) return fail('У этого аккаунта нет логина/пароля в данных lzt.market');

    ctx.onProgress?.({ step: 'acquiring-token' });
    ctx.log.info(`[steam] acquiring refresh token for ${creds.login}`);
    let session = await acquireRefreshToken(creds);

    if (!session.ok) {
      switch (session.error.kind) {
        case 'needs-email-code': {
          if (!ctx.fetchEmailCode) return fail('Аккаунт требует код с почты');
          ctx.onProgress?.({ step: 'awaiting-email-code' });
          ctx.log.info('[steam] fetching email code from market');
          ctx.onProgress?.({ step: 'fetching-email-code' });
          const code = await ctx.fetchEmailCode(account.itemId);
          if (!code) return fail('Не удалось получить код с почты — попробуйте ещё раз');
          ctx.log.info('[steam] retrying with email code');
          ctx.onProgress?.({ step: 'acquiring-token', detail: 'с кодом из почты' });
          session = await acquireRefreshToken({ ...creds, emailCode: code });
          if (!session.ok) {
            const msg =
              session.error.kind === 'unknown'
                ? session.error.message
                : session.error.kind === 'bad-credentials'
                  ? session.error.message
                  : session.error.kind;
            return fail(`Steam отверг код с почты: ${msg}`);
          }
          break;
        }
        case 'needs-totp': {
          // The account uses a Steam Guard authenticator but the mafile wasn't in
          // the item data. Fetch it on demand (this cancels the item's guarantee,
          // so we only do it now that we know TOTP is required) and retry.
          if (!ctx.fetchSteamMafile)
            return fail('Аккаунт требует код Steam Guard (mafile недоступен)');
          ctx.log.info('[steam] fetching mafile for TOTP guard');
          const sharedSecret = await ctx.fetchSteamMafile(account.itemId);
          if (!sharedSecret) {
            return fail('Не удалось получить mafile для Steam Guard — попробуйте ещё раз');
          }
          ctx.log.info('[steam] retrying with mafile TOTP');
          ctx.onProgress?.({ step: 'acquiring-token', detail: 'с кодом Steam Guard' });
          session = await acquireRefreshToken({ ...creds, sharedSecret });
          if (!session.ok) {
            const msg =
              session.error.kind === 'unknown' || session.error.kind === 'bad-credentials'
                ? session.error.message
                : session.error.kind;
            return fail(`Steam отверг код Steam Guard: ${msg}`);
          }
          break;
        }
        case 'needs-device-confirm':
          return fail('Аккаунт ждёт подтверждения на мобильном устройстве Steam Guard');
        case 'needs-email-confirm':
          return fail('Аккаунт ждёт подтверждения по ссылке из письма');
        case 'bad-credentials':
          return fail(`Steam отверг логин/пароль: ${session.error.message}`);
        default:
          return fail(`Ошибка входа в Steam: ${session.error.message}`);
      }
    }

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

    ctx.onProgress?.({ step: 'launching-steam' });
    ctx.log.info('[steam] launching via steam://0');
    const child = spawn('cmd', ['/c', 'start', '', 'steam://0'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    child.unref();

    return {
      ok: true,
      method,
      launchedPid: child.pid,
      message: `Steam запущен под аккаунтом ${login}`,
    };
  },
};
