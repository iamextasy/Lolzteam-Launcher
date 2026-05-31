import log from 'electron-log/main';
import { app } from 'electron';
import { MarketClient } from '@market-sdk';
import { categoryNameToServiceId } from '@shared-types';
import type {
  AccountDetails,
  AccountSummary,
  AuthSession,
  ServiceId,
  SteamGame,
  SteamInfo,
  TelegramInfo,
} from '@shared-types';
import { loadToken, onTokenChange } from '../auth/token-store';
import { extractSharedSecret } from '../adapters/steam/mafile';

let client: MarketClient | null = null;

const getClient = (): MarketClient => {
  if (!client) {
    client = new MarketClient({
      getToken: () => loadToken(),
      userAgent: `LolzteamLauncher/${app.getVersion?.() ?? '0.0.0'} (+desktop)`,
    });
  }
  return client;
};

onTokenChange(() => {
  client = null;
});

interface RawProfileResponse {
  user: {
    user_id: number;
    username: string;
    avatar_url?: string | null;
    view_url?: string | null;
    // Forum API returns balance as a string ("496910.40"); market API as a number.
    balance?: number | string;
    currency?: string;
    // Market `/me` nests rendered avatars + gradient username HTML here.
    rendered?: {
      username?: string | null;
      avatars?: {
        l?: string | null;
        m?: string | null;
        s?: string | null;
      };
    };
    // The avatar lives under `links` (forum API only), not at `avatar_url`.
    links?: {
      avatar?: string | null;
      avatar_big?: string | null;
      avatar_small?: string | null;
      permalink?: string | null;
    };
    [key: string]: unknown;
  };
}

const pickAvatarUrl = (user: RawProfileResponse['user']): string | null =>
  user.rendered?.avatars?.l ??
  user.rendered?.avatars?.m ??
  user.rendered?.avatars?.s ??
  user.links?.avatar_big ??
  user.links?.avatar ??
  user.avatar_url ??
  null;

const pickUsernameHtml = (user: RawProfileResponse['user']): string | null => {
  const html = user.rendered?.username;
  return typeof html === 'string' && html.trim() ? html : null;
};

const parseBalance = (value: number | string | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const normalizeProfile = (raw: RawProfileResponse): AuthSession => ({
  userId: raw.user.user_id,
  username: raw.user.username,
  usernameHtml: pickUsernameHtml(raw.user),
  avatarUrl: pickAvatarUrl(raw.user),
  profileUrl: raw.user.view_url ?? raw.user.links?.permalink ?? null,
  balance: parseBalance(raw.user.balance),
  // Forum API gives a lowercase code ("rub"); uppercase it for display/Intl.
  currency:
    typeof raw.user.currency === 'string' ? raw.user.currency.toUpperCase() : null,
});

export const fetchProfile = async (): Promise<AuthSession | null> => {
  const token = await loadToken();
  if (!token) return null;
  // Market `/me` returns rendered avatars + gradient username HTML + balance in
  // one call. Fall back to the forum `/users/me` shape if it ever lacks a user.
  try {
    const raw = (await getClient().me()) as RawProfileResponse;
    if (raw?.user) return normalizeProfile(raw);
    log.warn('[market] me() returned no user; falling back to forum profile');
  } catch (err) {
    log.warn('[market] me() failed; falling back to forum profile', err);
  }
  try {
    const raw = (await getClient().meForum()) as RawProfileResponse;
    if (!raw?.user) return null;
    return normalizeProfile(raw);
  } catch (err) {
    log.warn('[market] fetchProfile fallback failed', err);
    return null;
  }
};

interface RawItem {
  item_id: number;
  title?: string;
  title_en?: string;
  description?: string;
  price: number;
  price_currency?: string;
  item_image?: string;
  item_image_url?: string;
  warranty_end_at?: number;
  published_date?: number;
  item_state?: string;
  category?: {
    name?: string;
    title?: string;
    category_name?: string;
    category_title?: string;
  };
  category_name?: string;
  category_title?: string;
  [key: string]: unknown;
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// XenForo flags arrive as 0/1 ints (sometimes strings). Treat any truthy
// non-zero numeric as "on".
const asFlag = (v: unknown): boolean => {
  const n = asNumber(v);
  return n !== null && n !== 0;
};

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

// The market sends Telegram country as an ISO alpha-2 code but Steam country as
// a full English name ("Ukraine"). Build a reverse English-name → ISO lookup
// once so SteamInfo.country is normalized to the same ISO codes the UI expects
// for flag rendering. Codes that don't resolve fall through to null.
const ENGLISH_REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

const buildCountryNameToIso = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = ENGLISH_REGION_NAMES.of(code);
      } catch {
        name = undefined;
      }
      // `of` echoes the input code back when it isn't a real region.
      if (name && name !== code) map.set(name.toLowerCase(), code);
    }
  }
  return map;
};

const COUNTRY_NAME_TO_ISO = buildCountryNameToIso();

// Returns an ISO alpha-2 code given either an ISO code or an English country
// name; null when it can't be resolved.
const toIsoCountry = (value: unknown): string | null => {
  const raw = asString(value);
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return COUNTRY_NAME_TO_ISO.get(raw.toLowerCase()) ?? null;
};

const extractSteamTags = (item: Record<string, unknown>): string[] => {
  const tags = item.tags;
  if (!tags || typeof tags !== 'object') return [];
  const out: string[] = [];
  for (const entry of Object.values(tags as Record<string, unknown>)) {
    if (entry && typeof entry === 'object') {
      const title = asString((entry as { title?: unknown }).title);
      if (title) out.push(title);
    }
  }
  return out;
};

// Top games by hours played. Icons resolve from parentGameId on the FE CDN.
const extractSteamGames = (item: Record<string, unknown>, max = 6): SteamGame[] => {
  const full = item.steam_full_games;
  const list =
    full && typeof full === 'object'
      ? (full as { list?: unknown }).list
      : null;
  if (!list || typeof list !== 'object') return [];
  const games: SteamGame[] = [];
  for (const raw of Object.values(list as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    const appId = asNumber(g.appid);
    const parentGameId = asNumber(g.parentGameId) ?? appId;
    const title = asString(g.abbr) ?? asString(g.title);
    if (appId === null || parentGameId === null || !title) continue;
    games.push({
      appId,
      parentGameId,
      title,
      hours: asNumber(g.playtime_forever) ?? 0,
    });
  }
  games.sort((a, b) => b.hours - a.hours);
  return games.slice(0, max);
};

// Steam items expose a rich set of `steam_*` fields plus `tags`/origin. We surface
// a compact, display-ready subset; missing fields degrade to null/false so the
// list endpoint (which may omit some) still renders cleanly.
const extractSteamInfo = (
  item: Record<string, unknown>,
  serviceId: ServiceId | null,
): SteamInfo | null => {
  if (serviceId !== 'steam') return null;
  return {
    tags: extractSteamTags(item),
    level: asNumber(item.steam_level),
    gameCount: asNumber(item.steam_game_count),
    hasMfa: asFlag(item.steam_mfa),
    isLimited: asFlag(item.steam_is_limited),
    lastActivity: asNumber(item.steam_last_activity),
    vacBanned: asFlag(item.steam_community_ban) || asString(item.steam_bans) !== null,
    communityBanned: asFlag(item.steam_community_ban),
    tradeBanned: asFlag(item.steam_trade_ban),
    balance: asString(item.steam_balance),
    origin: asString(item.itemOriginPhrase),
    country: toIsoCountry(item.steam_country),
    games: extractSteamGames(item),
  };
};

const extractTelegramInfo = (
  item: Record<string, unknown>,
  serviceId: ServiceId | null,
): TelegramInfo | null => {
  if (serviceId !== 'telegram') return null;
  return {
    phone: asString(item.telegram_phone),
    username: asString(item.telegram_username),
    id: asNumber(item.telegram_id),
    country: asString(item.telegram_country),
    lastSeen: asNumber(item.telegram_last_seen),
    premium: asFlag(item.telegram_premium),
    premiumExpires: asNumber(item.telegram_premium_expires),
    // -1 means "unknown/not checked"; anything > 0 is an active block.
    spamBlocked: (asNumber(item.telegram_spam_block) ?? -1) > 0,
    tags: extractSteamTags(item),
    origin: asString(item.itemOriginPhrase),
    channelsCount: asNumber(item.telegram_channels_count),
    chatsCount: asNumber(item.telegram_chats_count),
    contactsCount: asNumber(item.telegram_contacts_count),
  };
};

// `buyer.operation_date` (when present) is when the current viewer purchased the
// item. Fall back to null so the card can hide the line.
const extractPurchasedAt = (item: Record<string, unknown>): number | null => {
  const buyer = item.buyer;
  if (buyer && typeof buyer === 'object') {
    const date = asNumber((buyer as { operation_date?: unknown }).operation_date);
    if (date) return date;
  }
  return null;
};

const pickCategoryRaw = (item: RawItem): string => {
  const cat = item.category;
  return (
    cat?.name ??
    cat?.category_name ??
    item.category_name ??
    ''
  ).toString();
};

const pickCategoryTitle = (item: RawItem): string => {
  const cat = item.category;
  return (
    cat?.title ??
    cat?.category_title ??
    item.category_title ??
    pickCategoryRaw(item) ??
    'Unknown'
  ).toString();
};

const normalizeItem = (item: RawItem): AccountSummary => {
  const categoryRaw = pickCategoryRaw(item);
  const category = categoryNameToServiceId(categoryRaw);
  return {
    itemId: item.item_id,
    category,
    categoryRaw,
    categoryTitle: pickCategoryTitle(item),
    title: item.title ?? item.title_en ?? `#${item.item_id}`,
    description: item.description ?? '',
    price: item.price ?? 0,
    currency: item.price_currency ?? 'RUB',
    imageUrl: item.item_image_url ?? item.item_image ?? null,
    warrantyEndsAt: item.warranty_end_at ?? null,
    publishedAt: item.published_date ?? null,
    purchasedAt: extractPurchasedAt(item as Record<string, unknown>),
    isPurchased: item.item_state === 'paid' || item.item_state === 'closed',
    steam: extractSteamInfo(item as Record<string, unknown>, category),
    telegram: extractTelegramInfo(item as Record<string, unknown>, category),
  };
};

type OnPage = (items: AccountSummary[], page: number) => void;

const paginateOrders = async (
  categoryId?: number,
  onPage?: OnPage,
): Promise<AccountSummary[]> => {
  const out: AccountSummary[] = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= 50) {
    const resp = await getClient().listOrders({ page, categoryId });
    const items = resp.items ?? [];
    const normalized = items.map(normalizeItem);
    out.push(...normalized);
    onPage?.(normalized, page);
    if (typeof resp.hasNextPage === 'boolean') {
      hasNext = resp.hasNextPage;
    } else {
      const perPage = resp.perPage || items.length;
      hasNext = items.length > 0 && perPage > 0 && page * perPage < resp.totalItems;
    }
    page += 1;
  }
  return out;
};

export const listPurchasedAccounts = async (): Promise<AccountSummary[]> => {
  const token = await loadToken();
  if (!token) return [];
  try {
    return await paginateOrders();
  } catch (err) {
    log.warn('[market] listPurchasedAccounts failed', err);
    return [];
  }
};

export const listAccountsByCategory = async (
  categoryId: number,
  onPage?: OnPage,
): Promise<AccountSummary[]> => {
  const token = await loadToken();
  if (!token) return [];
  try {
    return await paginateOrders(categoryId, onPage);
  } catch (err) {
    log.warn(`[market] listAccountsByCategory(${categoryId}) failed`, err);
    return [];
  }
};

export const fetchEmailCode = async (
  itemId: number,
  signal: AbortSignal,
): Promise<string | null> => {
  const token = await loadToken();
  if (!token) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (signal.aborted) return null;
    try {
      const resp = await getClient().getEmailCode(itemId);
      if ('codeData' in resp && resp.codeData && typeof resp.codeData.code === 'string') {
        const code = resp.codeData.code.trim();
        if (code) return code;
      }
      const err = (resp as { error?: string }).error;
      if (err && err !== 'retry_request') {
        log.warn(`[market] getEmailCode returned error: ${err}`);
        return null;
      }
    } catch (err) {
      log.warn('[market] getEmailCode threw', err);
      return null;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
};

export const fetchTelegramLoginCode = async (
  itemId: number,
  signal: AbortSignal,
): Promise<string | null> => {
  const token = await loadToken();
  if (!token) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (signal.aborted) return null;
    try {
      const resp = await getClient().getTelegramLoginCode(itemId);
      if ('codes' in resp && Array.isArray(resp.codes) && resp.codes.length > 0) {
        const newest = [...resp.codes].sort((a, b) => b.date - a.date)[0];
        if (newest && typeof newest.code === 'string') {
          const code = newest.code.trim();
          if (code) return code;
        }
      }
      if ('codeData' in resp && resp.codeData && typeof resp.codeData.code === 'string') {
        const code = resp.codeData.code.trim();
        if (code) return code;
      }
      const err = (resp as { error?: string }).error;
      if (err && err !== 'retry_request') {
        log.warn(`[market] getTelegramLoginCode returned error: ${err}`);
        return null;
      }
    } catch (err) {
      log.warn('[market] getTelegramLoginCode threw', err);
      return null;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
};

export const fetchSteamMafile = async (itemId: number): Promise<string | null> => {
  const token = await loadToken();
  if (!token) return null;
  try {
    const resp = await getClient().getSteamMafile(itemId);
    return extractSharedSecret(resp);
  } catch (err) {
    log.warn('[market] getSteamMafile failed', err);
    return null;
  }
};

const asTrimmedString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const pickLoginRaw = (
  item: Record<string, unknown>,
  serviceId: ServiceId | null,
): string | null => {
  const ld = item.loginData;
  const fromLoginData =
    ld && typeof ld === 'object' ? asTrimmedString((ld as { login?: unknown }).login) : null;
  const fromAccountLogin = asTrimmedString(item.account_login);

  if (serviceId === 'telegram') {
    return asTrimmedString(item.telegram_phone) ?? null;
  }
  return fromLoginData ?? fromAccountLogin;
};

const pickPasswordRaw = (
  item: Record<string, unknown>,
  serviceId: ServiceId | null,
): string | null => {
  const ld = item.loginData;
  const fromLoginData =
    ld && typeof ld === 'object' ? asTrimmedString((ld as { password?: unknown }).password) : null;
  const fromAccountPassword = asTrimmedString(item.account_password);

  if (serviceId === 'telegram') {
    return asTrimmedString(item.telegram_password_value) ?? null;
  }
  return fromLoginData ?? fromAccountPassword;
};

export const getAccountDetails = async (itemId: number): Promise<AccountDetails | null> => {
  try {
    const resp = (await getClient().getItem(itemId)) as { item?: RawItem & Record<string, unknown> };
    const item = resp.item;
    if (!item) return null;
    const summary = normalizeItem(item);
    const itemAsRecord = item as Record<string, unknown>;
    const loginRaw = pickLoginRaw(itemAsRecord, summary.category);
    const passwordRaw = pickPasswordRaw(itemAsRecord, summary.category);
    log.debug(
      `[market] item #${itemId} category=${summary.categoryRaw} ` +
        `loginRaw=${loginRaw ? 'present' : 'missing'} ` +
        `passwordRaw=${passwordRaw ? 'present' : 'missing'}`,
    );
    return {
      ...summary,
      loginRaw,
      passwordRaw,
      secrets: itemAsRecord,
    };
  } catch (err) {
    log.warn('[market] getAccountDetails failed', err);
    return null;
  }
};
