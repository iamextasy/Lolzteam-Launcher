import { randomBytes } from 'node:crypto';
import type { SteamWebClient } from '../../../client';
import { SteamWebError } from '../../../client';
import { EResult, eresultName } from '../../../eresult';
import { CHECKOUT } from '../../../hosts';

const randomText = (minLen: number, maxLen: number): string => {
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length]!;
  return out;
};

const isLoginPage = (html: string): boolean =>
  /<title[^>]*>\s*(Sign In|Войти)\s*<\/title>/i.test(html) ||
  /name="loginfriendlyname"/i.test(html);

export const submitSendGift = async (
  client: SteamWebClient,
  opts: {
    assetId: string;
    gifteeAccountId: string;
    gifteeEmail?: string;
    signal?: AbortSignal;
  },
): Promise<number> => {
  const referer = `${CHECKOUT}/checkout/sendgift/${opts.assetId}`;
  const prime = await client.get(referer, undefined, opts.signal);
  if (isLoginPage(prime.body)) {
    throw new SteamWebError('Checkout требует вход (куки/IP не совпали)');
  }

  const sessionId = await client.ensureSessionId(`${CHECKOUT}/`);
  const fields: Record<string, string> = {
    GifteeAccountID: opts.gifteeAccountId,
    GifteeEmail: opts.gifteeEmail ?? '',
    GifteeName: randomText(10, 20),
    GiftMessage: randomText(10, 20),
    GiftSentiment: 'Best Wishes',
    GiftSignature: randomText(10, 20),
    ScheduledSendOnDate: '0',
    GiftGID: opts.assetId,
    SessionID: sessionId,
    IsReschedule: 'false',
  };

  const res = await client.postForm(
    `${CHECKOUT}/checkout/sendgiftsubmit/`,
    fields,
    {
      Referer: referer,
      Origin: CHECKOUT,
      'X-Prototype-Version': '1.7',
      'X-Requested-With': 'XMLHttpRequest',
    },
    opts.signal,
  );

  let success = -1;
  try {
    success = Number((JSON.parse(res.body) as { success?: number }).success ?? -1);
  } catch {
    throw new SteamWebError(`sendgiftsubmit: невалидный ответ (${res.status})`);
  }
  if (success !== EResult.OK && success !== EResult.Pending) {
    throw new SteamWebError(`sendgiftsubmit ${eresultName(success)}`);
  }
  return success;
};
