import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { StringSessionData } from '@mtcute/node/utils.js';
import type { AccountDetails } from '@shared-types';
import { failLogin as fail } from '../_shared/fail';
import { extractTelegramCreds } from './extract';
import { ensurePortableMarker, fileExists, getTdataDir } from './paths';
import { killTelegramProcesses, waitForTelegramExit } from './process';
import { buildOfflineSession } from './session';
import { writeProxySettings } from './settings-tdf';
import { mergeSessions, readExistingSessions, toSessionData, writeTdata } from './tdata';

export const telegramAdapter: ServiceAdapter = {
  id: 'telegram',
  displayName: 'Telegram',
  platforms: ['win32'] as const,
  methods: ['native'] as const,

  async probe(method: LoginMethod, ctx: AdapterContext): Promise<ProbeResult> {
    if (method !== 'native') {
      return { available: false, reason: 'Только native-вход поддерживается' };
    }
    if (process.platform !== 'win32') {
      return { available: false, reason: 'Telegram-адаптер работает только на Windows' };
    }
    const exe = ctx.settings?.telegramExePath;
    if (!exe) {
      return { available: false, reason: 'Укажите путь к Telegram.exe в Настройках' };
    }
    if (!(await fileExists(exe))) {
      return { available: false, reason: 'Telegram.exe не найден по указанному пути' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'native') return fail('Только native-вход поддерживается', method);
    if (process.platform !== 'win32') return fail('Telegram-адаптер работает только на Windows');
    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    const exe = ctx.settings?.telegramExePath;
    if (!exe || !(await fileExists(exe))) {
      return fail('Укажите путь к Telegram.exe в Настройках');
    }

    const creds = extractTelegramCreds(account);
    if (!creds) return fail('У этого аккаунта нет данных Telegram в lzt.market');

    if (!creds.authKey) {
      return fail(
        'Нет данных сессии Telegram для восстановления (loginData.raw пуст или некорректен)',
      );
    }

    ctx.onProgress?.({ step: 'building-tdata' });
    let session: StringSessionData;
    try {
      session = buildOfflineSession({
        authKeyHex: creds.authKey.authKeyHex,
        dcId: creds.authKey.dcId,
        userId: creds.userId,
      });
      ctx.log.info(
        `[telegram] offline session built (dc=${creds.authKey.dcId}, userId=${creds.userId ?? 'none'})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Не удалось собрать сессию из auth_key: ${msg}`);
    }

    ctx.onProgress?.({ step: 'killing-telegram' });
    ctx.log.info('[telegram] killing Telegram processes');
    await killTelegramProcesses(exe);
    await waitForTelegramExit(exe, 5000);

    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    ctx.onProgress?.({ step: 'writing-tdata' });
    let tdataDir: string;
    try {
      tdataDir = await getTdataDir(exe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Папка с Telegram.exe недоступна на запись: ${msg}`);
    }
    // Preserve previously added accounts: read what's already in tdata, drop any
    // stale entry for this same user, prepend the new session (it becomes active)
    // and cap the total. Falls back to a single-account write if the existing
    // tdata can't be read (passcode/corruption/version), matching old behaviour.
    const incoming = toSessionData(session);
    const existing = await readExistingSessions(tdataDir, ctx.log);
    const merged = mergeSessions(incoming, existing);
    ctx.log.info(`[telegram] writing tdata to ${tdataDir}: ${merged.length} account(s) (offline)`);
    // Write into a staging dir first, then swap it into place. This way a failed
    // write never destroys the existing tdata — we only rm the live folder once
    // the new one is fully written.
    const stagingDir = `${tdataDir}.new`;
    try {
      await rm(stagingDir, { recursive: true, force: true });
      await writeTdata(merged, stagingDir);
      await rm(tdataDir, { recursive: true, force: true });
      await rename(stagingDir, tdataDir);
    } catch (err) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Не удалось записать сессию tdata: ${msg}`);
    }

    if (ctx.proxy) {
      try {
        await writeProxySettings(tdataDir, ctx.proxy);
        ctx.log.info(`[telegram] proxy settings written: ${ctx.proxy.host}:${ctx.proxy.port}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`[telegram] failed to write proxy settings (continuing direct): ${msg}`);
      }
    }

    // Without `tportable.tdat` next to the exe, Telegram Desktop reads
    // %APPDATA%\Telegram Desktop instead of our tdata and shows the phone-entry
    // screen — making the offline write look like it silently failed.
    try {
      await ensurePortableMarker(exe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Не удалось создать маркер portable-режима: ${msg}`);
    }

    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    ctx.onProgress?.({ step: 'launching-telegram' });
    ctx.log.info('[telegram] launching portable Telegram');
    const child = spawn(exe, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    const who = creds.phone || `аккаунт #${account.itemId}`;
    return {
      ok: true,
      method,
      launchedPid: child.pid,
      message: `Telegram запущен под ${who}`,
    };
  },
};
