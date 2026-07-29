import type { SteamWebClient } from '../../../client';
import { submitSendGift } from './checkout';

export const sendGiftByEmail = async (
  client: SteamWebClient,
  opts: {
    assetId: string;
    email: string;
    alreadySent: boolean;
    signal?: AbortSignal;
  },
): Promise<void> => {
  const once = () =>
    submitSendGift(client, {
      assetId: opts.assetId,
      gifteeAccountId: '0',
      gifteeEmail: opts.email,
      signal: opts.signal,
    });

  if (!opts.alreadySent) await once();
  await once();
};
