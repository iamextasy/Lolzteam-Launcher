import type { SteamWebClient } from '../../../client';
import { SteamWebError } from '../../../client';
import { parseInviteLink, redeemFriendInvite } from '../../friends/invite-link';
import { submitSendGift } from './checkout';

export const sendGiftByInvite = async (
  client: SteamWebClient,
  opts: {
    assetId: string;
    inviteUrl: string;
    signal?: AbortSignal;
  },
): Promise<void> => {
  const parsed = parseInviteLink(opts.inviteUrl);
  if (!parsed) throw new SteamWebError('Некорректная invite-ссылка');

  await redeemFriendInvite(client, {
    steamId64: parsed.steamId64,
    inviteToken: parsed.inviteToken,
    signal: opts.signal,
  });

  await submitSendGift(client, {
    assetId: opts.assetId,
    gifteeAccountId: parsed.accountId,
    signal: opts.signal,
  });
};
