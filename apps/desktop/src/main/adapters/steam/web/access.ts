import type { AccountDetails, ProxyEntry } from '@shared-types';
import { fetchEmailCode, fetchSteamMafile } from '../../../services/market';
import { extractSteamCreds } from '../extract';
import { type SessionError, acquireWebSession } from '../session';
import { SteamWebClient, SteamWebError } from './client';
import { proxyUrlForSteamSession } from './proxy-url';

const TTL_MS = 15 * 60_000;

type Creds = {
  login: string;
  password: string;
  sharedSecret: string | null;
  emailCode?: string;
};

type CachedAuth = {
  cookies: string[];
  steamId: string;
  proxyKey: string;
  alreadySent: Map<string, boolean>;
  expiresAt: number;
};

const cache = new Map<number, CachedAuth>();

const proxyKey = (proxy?: ProxyEntry | null): string =>
  proxy ? `${proxy.id}:${proxy.host}:${proxy.port}` : '';

const errMsg = (error: SessionError): string =>
  error.kind === 'unknown' || error.kind === 'bad-credentials' ? error.message : error.kind;

const loginWithGuards = async (
  account: AccountDetails,
  creds: Creds,
  httpProxy: string | null,
  signal?: AbortSignal,
): Promise<{ cookies: string[]; steamId: string }> => {
  const acquire = (c: Creds) => acquireWebSession({ ...c, httpProxy });

  let session = await acquire(creds);
  if (!session.ok) {
    if (session.error.kind === 'needs-email-code') {
      if (signal?.aborted) throw new SteamWebError('Отменено');
      const code = await fetchEmailCode(account.itemId, signal ?? AbortSignal.timeout(120_000));
      if (!code) throw new SteamWebError('Не удалось получить код с почты');
      session = await acquire({ ...creds, emailCode: code });
    } else if (session.error.kind === 'needs-totp') {
      if (signal?.aborted) throw new SteamWebError('Отменено');
      const sharedSecret = await fetchSteamMafile(account.itemId);
      if (!sharedSecret) throw new SteamWebError('Не удалось получить mafile для Steam Guard');
      session = await acquire({ ...creds, sharedSecret });
    }
  }

  if (!session.ok) throw new SteamWebError(errMsg(session.error));
  return { cookies: session.data.cookies, steamId: session.data.steamId };
};

export type OpenSteamWeb = {
  client: SteamWebClient;
  steamId: string;
  alreadySent: Map<string, boolean>;
};

export const clearSteamWebCache = (itemId: number): void => {
  cache.delete(itemId);
};

export const getSteamWebCookies = async (opts: {
  account: AccountDetails;
  proxy?: ProxyEntry | null;
  signal?: AbortSignal;
}): Promise<{ cookies: string[]; steamId: string }> => {
  const itemId = opts.account.itemId;
  const key = proxyKey(opts.proxy);
  const hit = cache.get(itemId);
  if (hit && hit.proxyKey === key && hit.expiresAt > Date.now()) {
    return { cookies: hit.cookies, steamId: hit.steamId };
  }

  const creds = extractSteamCreds(opts.account);
  if (!creds) throw new SteamWebError('У аккаунта нет логина/пароля');

  const httpProxy = opts.proxy ? proxyUrlForSteamSession(opts.proxy) : null;
  const { cookies, steamId } = await loginWithGuards(opts.account, creds, httpProxy, opts.signal);

  cache.set(itemId, {
    cookies,
    steamId,
    proxyKey: key,
    alreadySent: hit?.proxyKey === key ? hit.alreadySent : new Map(),
    expiresAt: Date.now() + TTL_MS,
  });

  return { cookies, steamId };
};

export const openSteamWeb = async (opts: {
  account: AccountDetails;
  proxy?: ProxyEntry | null;
  signal?: AbortSignal;
}): Promise<OpenSteamWeb> => {
  const { cookies, steamId } = await getSteamWebCookies(opts);
  const entry = cache.get(opts.account.itemId);
  if (!entry) throw new SteamWebError('Steam web cache missing after login');

  const client = await SteamWebClient.create(opts.proxy);
  await client.injectSetCookies(cookies);
  return { client, steamId, alreadySent: entry.alreadySent };
};
