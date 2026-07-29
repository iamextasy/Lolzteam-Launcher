import type { SteamWebClient } from '../../client';
import { SteamWebError } from '../../client';
import { COMMUNITY } from '../../hosts';

const INVENTORY_QS = 'l=english&count=2000&preserve_bbcode=1&raw_asset_properties=1';

export const fetchInventory753 = async (
  client: SteamWebClient,
  steamId: string,
  signal?: AbortSignal,
): Promise<unknown> => {
  const url = `${COMMUNITY}/inventory/${steamId}/753/1?${INVENTORY_QS}`;
  const referer = `${COMMUNITY}/profiles/${steamId}/inventory/`;
  const res = await client.get(
    url,
    { Referer: referer, 'X-Requested-With': 'XMLHttpRequest' },
    signal,
  );
  if (res.status !== 200) {
    throw new SteamWebError(`Inventory HTTP ${res.status}`);
  }
  try {
    return JSON.parse(res.body) as unknown;
  } catch {
    throw new SteamWebError('Inventory: невалидный JSON');
  }
};
