/**
 * Steam invite code decode — xPaw SteamID.php `ParseSteamInvite` / SteamKit.
 * @see https://github.com/xPaw/SteamID.php
 */

import type { SteamWebClient } from '../../client';
import { SteamWebError } from '../../client';
import { EResult, eresultName } from '../../eresult';
import { COMMUNITY } from '../../hosts';

/** SteamInviteDictionaryFlipped from xPaw */
const INVITE_DECODE: Readonly<Record<string, string>> = {
  b: '0',
  c: '1',
  d: '2',
  f: '3',
  g: '4',
  h: '5',
  j: '6',
  k: '7',
  m: '8',
  n: '9',
  p: 'a',
  q: 'b',
  r: 'c',
  t: 'd',
  v: 'e',
  w: 'f',
};

/** SteamInviteDictionary from xPaw (encode / tests) */
const INVITE_ENCODE: Readonly<Record<string, string>> = {
  '0': 'b',
  '1': 'c',
  '2': 'd',
  '3': 'f',
  '4': 'g',
  '5': 'h',
  '6': 'j',
  '7': 'k',
  '8': 'm',
  '9': 'n',
  a: 'p',
  b: 'q',
  c: 'r',
  d: 't',
  e: 'v',
  f: 'w',
};

const STEAM64_BASE = 76561197960265728n;

export interface ParsedInviteLink {
  steamId64: string;
  accountId: string;
  inviteToken: string;
}

/** xPaw: strip non-alphabet → strtr(flipped) → hex → FromAccountID */
export const decodeInviteCode = (code: string): string | null => {
  const cleaned = code.toLowerCase().replace(/[^bcdfghjkmnpqrtvw]/g, '');
  if (!cleaned) return null;

  let hex = '';
  for (const ch of cleaned) {
    const digit = INVITE_DECODE[ch];
    if (digit === undefined) return null;
    hex += digit;
  }

  const accountIdNum = Number.parseInt(hex, 16);
  if (!Number.isFinite(accountIdNum) || accountIdNum <= 0 || accountIdNum > 0xffffffff) {
    return null;
  }
  return String(accountIdNum);
};

export const accountIdToSteam64 = (accountId: string): string =>
  (BigInt(accountId) + STEAM64_BASE).toString();

/** xPaw RenderSteamInvite (Individual) */
export const encodeInviteCode = (accountId: number | string): string => {
  const id = typeof accountId === 'string' ? Number.parseInt(accountId, 10) : accountId;
  let code = '';
  for (const ch of id.toString(16)) code += INVITE_ENCODE[ch] ?? ch;
  if (code.length > 3) {
    const mid = Math.floor(code.length / 2);
    code = `${code.slice(0, mid)}-${code.slice(mid)}`;
  }
  return code;
};

/**
 * Friend-add URLs with token (token is for ajaxredeem, not SteamID):
 * - https://s.team/p/{code}/{token}
 * - https://steamcommunity.com/user/{code}/{token}
 *
 * SteamID = ParseSteamInvite({code}) only.
 */
export const parseInviteLink = (raw: string): ParsedInviteLink | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const m = trimmed.match(
    /(?:https?:\/\/)?(?:s\.team\/p|steamcommunity\.com\/user)\/([bcdfghjkmnpqrtvw\-]+)\/([A-Za-z0-9_-]+)/i,
  );
  if (!m) return null;

  const inviteToken = m[2] ?? '';
  const accountId = decodeInviteCode(m[1] ?? '');
  if (!accountId || !inviteToken) return null;

  return {
    accountId,
    steamId64: accountIdToSteam64(accountId),
    inviteToken,
  };
};

export const redeemFriendInvite = async (
  client: SteamWebClient,
  opts: {
    steamId64: string;
    inviteToken: string;
    signal?: AbortSignal;
  },
): Promise<void> => {
  const sessionid = await client.ensureSessionId(`${COMMUNITY}/`);
  const qs = new URLSearchParams({
    sessionid,
    steamid_user: opts.steamId64,
    invite_token: opts.inviteToken,
  });
  const url = `${COMMUNITY}/invites/ajaxredeem?${qs.toString()}`;
  const res = await client.get(
    url,
    { Referer: `${COMMUNITY}/`, 'X-Requested-With': 'XMLHttpRequest' },
    opts.signal,
  );

  let success = -1;
  try {
    success = Number((JSON.parse(res.body) as { success?: number }).success ?? -1);
  } catch {
    throw new SteamWebError(`ajaxredeem: невалидный ответ (${res.status})`);
  }

  if (success === EResult.OK || success === EResult.NotModified) return;
  throw new SteamWebError(`ajaxredeem ${eresultName(success)}`);
};
