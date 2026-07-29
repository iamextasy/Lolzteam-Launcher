import type {
  GiftsDestKind,
  GiftsTransferError,
  GiftsTransferProgress,
  GiftsTransferResult,
  SteamGiftItem,
} from '@shared-ipc';
import { clearSteamWebCache, openSteamWeb } from '../../../access';
import { SteamWebError } from '../../../client';
import { fetchInventory753 } from '../get';
import { parseInventoryGifts } from '../parse';
import { sendGiftByEmail } from './email';
import { sendGiftByInvite } from './friend';

type SteamWebOpts = Parameters<typeof openSteamWeb>[0];

export const listAccountGifts = async (opts: SteamWebOpts): Promise<SteamGiftItem[]> => {
  const { client, steamId, alreadySent } = await openSteamWeb(opts);
  try {
    const raw = await fetchInventory753(client, steamId, opts.signal);
    const parsed = parseInventoryGifts(raw).filter((g) => g.tradable);
    alreadySent.clear();
    for (const g of parsed) alreadySent.set(g.id, g.alreadySent);
    return parsed;
  } finally {
    await client.dispose();
  }
};

export const transferAccountGifts = async (
  opts: SteamWebOpts & {
    destKind: GiftsDestKind;
    pairs: Array<{ assetId: string; recipient: string }>;
    giftNames?: Record<string, string>;
    onProgress?: (p: Omit<GiftsTransferProgress, 'itemId'>) => void;
  },
): Promise<GiftsTransferResult> => {
  const { client, alreadySent } = await openSteamWeb(opts);
  const errors: GiftsTransferError[] = [];
  let okCount = 0;

  try {
    const total = opts.pairs.length;

    for (let i = 0; i < opts.pairs.length; i++) {
      if (opts.signal?.aborted) break;
      const pair = opts.pairs[i]!;
      const giftName = opts.giftNames?.[pair.assetId] ?? pair.assetId;

      opts.onProgress?.({
        done: i,
        total,
        assetId: pair.assetId,
        giftName,
        recipient: pair.recipient,
      });

      try {
        if (opts.destKind === 'email') {
          await sendGiftByEmail(client, {
            assetId: pair.assetId,
            email: pair.recipient,
            alreadySent: alreadySent.get(pair.assetId) ?? false,
            signal: opts.signal,
          });
        } else {
          await sendGiftByInvite(client, {
            assetId: pair.assetId,
            inviteUrl: pair.recipient,
            signal: opts.signal,
          });
        }
        okCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          assetId: pair.assetId,
          giftName,
          recipient: pair.recipient,
          message,
        });
      }

      opts.onProgress?.({
        done: i + 1,
        total,
        assetId: pair.assetId,
        giftName,
        recipient: pair.recipient,
      });
    }
  } catch (err) {
    const message =
      err instanceof SteamWebError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, okCount, failCount: errors.length + 1, errors, message };
  } finally {
    await client.dispose();
    clearSteamWebCache(opts.account.itemId);
  }

  return {
    ok: errors.length === 0 && okCount === opts.pairs.length,
    okCount,
    failCount: errors.length,
    errors,
  };
};
