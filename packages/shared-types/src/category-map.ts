import type { ServiceId } from './service-id';

const NAME_TO_SERVICE: Record<string, ServiceId> = {
  steam: 'steam',
  telegram: 'telegram',
  discord: 'discord',
  fortnite: 'fortnite',
  mihoyo: 'mihoyo',
  riot: 'riot',
  supercell: 'supercell',
  ea: 'ea',
  origin: 'ea',
  wot: 'wot',
  'wot-blitz': 'wotblitz',
  wotblitz: 'wotblitz',
  gifts: 'gifts',
  epicgames: 'epicgames',
  'epic-games': 'epicgames',
  eft: 'eft',
  'escape-from-tarkov': 'eft',
  socialclub: 'socialclub',
  'social-club': 'socialclub',
  uplay: 'uplay',
  tiktok: 'tiktok',
  instagram: 'instagram',
  battlenet: 'battlenet',
  'battle-net': 'battlenet',
  llm: 'llm',
  vpn: 'vpn',
  roblox: 'roblox',
  warface: 'warface',
  minecraft: 'minecraft',
  hytale: 'hytale',
};

export const categoryNameToServiceId = (name: string | undefined | null): ServiceId | null => {
  if (!name) return null;
  return NAME_TO_SERVICE[name.toLowerCase()] ?? null;
};

export const SERVICE_CATEGORY_ID: Partial<Record<ServiceId, number>> = {
  steam: 1,
  telegram: 24,
  tiktok: 20,
  instagram: 10,
  discord: 22,
};
