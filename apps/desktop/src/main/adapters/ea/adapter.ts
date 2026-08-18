import { spawn } from 'node:child_process';
import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails } from '@shared-types';
import { failLogin as fail } from '../_shared/fail';
import { type EaErrorCode, EaLoginError, performEaLogin } from './auth';
import { readCefAesKey, writeCefCookies } from './cookies';
import { extractEaCreds } from './extract';
import { findEaPaths } from './paths';
import { killEaProcesses, waitForEaExit } from './process';

export const eaAdapter: ServiceAdapter = {
  id: 'ea',
  displayName: 'EA Desktop',
  platforms: ['win32'],
  methods: ['native'],

  async probe(_method: LoginMethod, _ctx: AdapterContext): Promise<ProbeResult> {
    if (process.platform !== 'win32') {
      return { available: false, reason: 'EA Desktop adapter requires Windows' };
    }
    const paths = await findEaPaths();
    if (!paths) {
      return { available: false, reason: 'EA Desktop not found in registry' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'native') return fail('Only native login is supported for EA Desktop', method);
    if (process.platform !== 'win32') return fail('EA Desktop adapter requires Windows');

    const paths = await findEaPaths();
    if (!paths) return fail('EA Desktop не найден в системе (проверьте установку)');

    const creds = extractEaCreds(account);
    if (!creds) return fail('У этого аккаунта нет email/пароля в данных lzt.market');

    ctx.onProgress?.({ step: 'acquiring-token' });
    ctx.log.info(`[ea] performing OAuth login for item #${account.itemId}`);

    let session: { remid: string; sid?: string };
    try {
      session = await performEaLogin(
        creds.email,
        creds.password,
        ctx.fetchEmailCode
          ? async () => {
              ctx.onProgress?.({ step: 'awaiting-email-code' });
              ctx.log.info('[ea] fetching email code from market');
              ctx.onProgress?.({ step: 'fetching-email-code' });
              return ctx.fetchEmailCode!(account.itemId);
            }
          : undefined,
        ctx.abortSignal,
      );
    } catch (err) {
      if (ctx.abortSignal.aborted) return fail('Вход отменён');
      if (err instanceof EaLoginError) {
        const EA_ERROR_MESSAGES: Partial<Record<EaErrorCode, string>> = {
          'bad-credentials': 'EA отверг email или пароль — проверьте данные аккаунта',
          'needs-2fa': 'Не удалось получить код подтверждения с почты',
          'bad-2fa-code': 'Неверный или просроченный код — попробуйте снова',
          'no-remid': 'EA не вернул сессионный cookie — попробуйте ещё раз',
        };
        return fail(EA_ERROR_MESSAGES[err.code] ?? `Ошибка входа в EA: ${err.message}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Ошибка входа в EA: ${msg}`);
    }

    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    ctx.onProgress?.({ step: 'killing-ea' });
    ctx.log.info('[ea] killing EA processes');
    await killEaProcesses();
    await waitForEaExit(5000);

    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    ctx.onProgress?.({ step: 'writing-ea-session' });
    ctx.log.info('[ea] writing session cookies to CEF database');

    let aesKey: Buffer;
    try {
      aesKey = await readCefAesKey(paths.localPrefsPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Не удалось прочитать AES ключ EA Desktop: ${msg}`);
    }

    try {
      writeCefCookies(paths.cookiesDbPath, aesKey, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Не удалось записать сессию в EA Desktop: ${msg}`);
    }

    ctx.onProgress?.({ step: 'launching-ea' });
    ctx.log.info(`[ea] launching ${paths.exePath}`);
    const child = spawn(paths.exePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    return {
      ok: true,
      method: 'native',
      launchedPid: child.pid,
      message: `EA Desktop запущен под аккаунтом ${creds.email}`,
    };
  },
};
