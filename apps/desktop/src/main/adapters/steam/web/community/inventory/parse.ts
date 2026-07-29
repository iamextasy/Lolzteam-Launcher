import type { SteamGiftItem } from '@shared-ipc';
import { GUEST_PASS_MARKER, ICON_CDN, RESTRICTED_GIFT_MARKER } from './markers';

type RawAsset = { assetid?: string; classid?: string; instanceid?: string };
type OwnerEntry = { value?: string };
type RawDesc = {
  classid?: string;
  instanceid?: string;
  name?: string;
  market_hash_name?: string;
  tradable?: number;
  icon_url_large?: string;
  fraudwarnings?: string[];
  owner_descriptions?: OwnerEntry[];
};

type RawInventory = {
  assets?: RawAsset[];
  descriptions?: RawDesc[];
};

const descKey = (classid: string, instanceid: string): string =>
  instanceid === '0' ? classid : `${classid}_${instanceid}`;

const giftIconUrl = (iconUrlLarge: string | undefined): string | null => {
  if (!iconUrlLarge) return null;
  return `${ICON_CDN}/${iconUrlLarge.replace(/^\/+/, '')}/330x192?allow_animated=0`;
};

const countriesFromWarning = (warning: string): string | null => {
  if (!warning.startsWith(RESTRICTED_GIFT_MARKER)) return null;
  const rest = warning.slice(RESTRICTED_GIFT_MARKER.length).replace(/^[\s:]+/, '');
  return rest || null;
};

export type ParsedGift = SteamGiftItem & { marketHashName: string };

export const parseInventoryGifts = (raw: unknown): ParsedGift[] => {
  const inv = raw as RawInventory;
  const assets = inv.assets ?? [];
  const descs = new Map<string, RawDesc>();
  for (const d of inv.descriptions ?? []) {
    if (!d.classid) continue;
    descs.set(descKey(d.classid, d.instanceid ?? '0'), d);
  }

  const out: ParsedGift[] = [];
  for (const asset of assets) {
    if (!asset.assetid || !asset.classid) continue;
    const desc = descs.get(descKey(asset.classid, asset.instanceid ?? '0'));
    if (!desc) continue;

    const warnings = desc.fraudwarnings ?? [];
    const regionalWarning = warnings.find((w) => w.includes(RESTRICTED_GIFT_MARKER));
    const timed = warnings.some((w) => w.includes(GUEST_PASS_MARKER));
    const alreadySent = (desc.owner_descriptions ?? []).some((e) =>
      (e.value ?? '').startsWith('Sent to'),
    );

    out.push({
      id: asset.assetid,
      name: desc.name ?? desc.market_hash_name ?? asset.assetid,
      marketHashName: desc.market_hash_name ?? desc.name ?? asset.assetid,
      iconUrl: giftIconUrl(desc.icon_url_large),
      timed,
      regional: Boolean(regionalWarning),
      restrictionCountries: regionalWarning ? countriesFromWarning(regionalWarning) : null,
      tradable: (desc.tradable ?? 0) !== 0,
      alreadySent,
    });
  }
  return out;
};
