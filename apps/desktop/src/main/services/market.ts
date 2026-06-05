import { MarketClient } from '@market-sdk';
import type { RawMarketItem, RawProfileResponse } from '@market-sdk';
import { categoryNameToServiceId } from '@shared-types';
import type {
  AccountDetails,
  AccountSummary,
  AccountTag,
  AuthSession,
  ServiceId,
  SteamGame,
  SteamInfo,
  TelegramInfo,
} from '@shared-types';
import { app } from 'electron';
import log from 'electron-log/main';
import { extractSharedSecret } from '../adapters/steam/mafile';
import { loadToken, onTokenChange } from '../auth/token-store';

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

// Bumped on every token change (login/logout). In-flight pagination captures
// the epoch at start and bails between pages when it changes, so a stale loop
// can't fire a request with a cleared/replaced token (→ spurious 401).
let tokenEpoch = 0;

onTokenChange(() => {
  client = null;
  tokenEpoch += 1;
});

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
  currency: typeof raw.user.currency === 'string' ? raw.user.currency.toUpperCase() : null,
});

export const fetchProfile = async (): Promise<AuthSession | null> => {
  const result = await fetchProfileResult();
  return result.kind === 'ok' ? result.session : null;
};

export type ProfileResult =
  | { kind: 'ok'; session: AuthSession }
  | { kind: 'offline' }
  | { kind: 'unauthorized' };

const httpStatusOf = (err: unknown): number | null => {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { status?: number } }).response;
    if (res && typeof res.status === 'number') return res.status;
  }
  return null;
};

const isAuthRejection = (err: unknown): boolean => {
  const status = httpStatusOf(err);
  return status === 401 || status === 403;
};

export const fetchProfileResult = async (): Promise<ProfileResult> => {
  const token = await loadToken();
  if (!token) return { kind: 'unauthorized' };
  // Market `/me` returns rendered avatars + gradient username HTML + balance in
  // one call. Fall back to the forum `/users/me` shape if it ever lacks a user.
  try {
    const raw = await getClient().me();
    if (raw?.user) return { kind: 'ok', session: normalizeProfile(raw) };
    log.warn('[market] me() returned no user; falling back to forum profile');
  } catch (err) {
    if (isAuthRejection(err)) return { kind: 'unauthorized' };
    log.warn('[market] me() failed; falling back to forum profile', err);
  }
  try {
    const raw = await getClient().meForum();
    if (raw?.user) return { kind: 'ok', session: normalizeProfile(raw) };
  } catch (err) {
    if (isAuthRejection(err)) return { kind: 'unauthorized' };
    log.warn('[market] fetchProfile fallback failed', err);
  }
  return { kind: 'offline' };
};

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

const extractTags = (item: RawMarketItem): AccountTag[] => {
  const tags = item.tags;
  if (!tags || typeof tags !== 'object') return [];
  const out: AccountTag[] = [];
  for (const entry of Object.values(tags as Record<string, unknown>)) {
    if (entry && typeof entry === 'object') {
      const id = asNumber((entry as { tag_id?: unknown }).tag_id);
      const title = asString((entry as { title?: unknown }).title)?.trim();
      if (id !== null && title) out.push({ id, title });
    }
  }
  return out;
};

interface SteamBans {
  vacBanned: boolean;
  communityBanned: boolean;
  tradeBanned: boolean;
}

const extractSteamBans = (item: RawMarketItem): SteamBans => {
  const bans = item.steam_bans;
  const obj = bans && typeof bans === 'object' ? (bans as Record<string, unknown>) : null;

  const vacBanned =
    asFlag(item.steam_vac) ||
    (obj ? asFlag(obj.VACBanned) || (asNumber(obj.NumberOfVACBans) ?? 0) > 0 : false);

  const communityBanned =
    asFlag(item.steam_community_ban) || (obj ? asFlag(obj.CommunityBanned) : false);

  const tradeBanned =
    asFlag(item.steam_trade_ban) ||
    (obj ? asString(obj.EconomyBan) !== null && asString(obj.EconomyBan) !== 'none' : false);

  return { vacBanned, communityBanned, tradeBanned };
};

const RESOLD_TAG_TITLES = new Set(['перепродан', 'resold']);

const isResold = (item: RawMarketItem): boolean =>
  extractTags(item).some((tag) => RESOLD_TAG_TITLES.has(tag.title.trim().toLowerCase()));

// Top games by hours played. Icons resolve from parentGameId on the FE CDN.
const extractSteamGames = (item: RawMarketItem, max = 6): SteamGame[] => {
  const full = item.steam_full_games;
  const list = full && typeof full === 'object' ? (full as { list?: unknown }).list : null;
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
const extractSteamInfo = (item: RawMarketItem, serviceId: ServiceId | null): SteamInfo | null => {
  if (serviceId !== 'steam') return null;
  const bans = extractSteamBans(item);
  return {
    tags: extractTags(item),
    level: asNumber(item.steam_level),
    gameCount: asNumber(item.steam_game_count),
    hasMfa: asFlag(item.steam_mfa),
    isLimited: asFlag(item.steam_is_limited),
    lastActivity: asNumber(item.steam_last_activity),
    vacBanned: bans.vacBanned,
    communityBanned: bans.communityBanned,
    tradeBanned: bans.tradeBanned,
    balance: asString(item.steam_balance),
    origin: asString(item.itemOriginPhrase),
    country: toIsoCountry(item.steam_country),
    games: extractSteamGames(item),
  };
};

const extractTelegramInfo = (
  item: RawMarketItem,
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
    tags: extractTags(item),
    origin: asString(item.itemOriginPhrase),
    channelsCount: asNumber(item.telegram_channels_count),
    chatsCount: asNumber(item.telegram_chats_count),
    contactsCount: asNumber(item.telegram_contacts_count),
  };
};

// `buyer.operation_date` (when present) is when the current viewer purchased the
// item. Fall back to null so the card can hide the line.
const extractPurchasedAt = (item: RawMarketItem): number | null => {
  const buyer = item.buyer;
  if (buyer && typeof buyer === 'object') {
    const date = asNumber((buyer as { operation_date?: unknown }).operation_date);
    if (date) return date;
  }
  return null;
};

const pickCategoryRaw = (item: RawMarketItem): string => {
  const cat = item.category;
  return (cat?.name ?? cat?.category_name ?? item.category_name ?? '').toString();
};

const pickCategoryTitle = (item: RawMarketItem): string => {
  const cat = item.category;
  return (
    cat?.title ??
    cat?.category_title ??
    item.category_title ??
    pickCategoryRaw(item) ??
    'Unknown'
  ).toString();
};

const normalizeItem = (item: RawMarketItem): AccountSummary => {
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
    tags: extractTags(item),
    warrantyEndsAt: item.warranty_end_at ?? null,
    publishedAt: item.published_date ?? null,
    purchasedAt: extractPurchasedAt(item),
    isPurchased: item.item_state === 'paid' || item.item_state === 'closed',
    steam: extractSteamInfo(item, category),
    telegram: extractTelegramInfo(item, category),
  };
};

type PageProgress = { page: number; totalPages: number | null };
type OnPage = (items: AccountSummary[], progress: PageProgress) => void;

const paginateOrders = async (categoryId?: number, onPage?: OnPage): Promise<AccountSummary[]> => {
  const epoch = tokenEpoch;
  const out: AccountSummary[] = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= 50) {
    // Token changed mid-stream (logout/re-login): stop before the next request
    // so we don't hit the API with a stale token.
    if (tokenEpoch !== epoch) break;
    const resp = await getClient().listOrders({ page, categoryId });
    const items = resp.items ?? [];
    const normalized = items.filter((it) => !isResold(it)).map(normalizeItem);
    out.push(...normalized);
    const perPage = resp.perPage || items.length;
    const totalPages =
      perPage > 0 && resp.totalItems > 0 ? Math.ceil(resp.totalItems / perPage) : null;
    onPage?.(normalized, { page, totalPages });
    if (typeof resp.hasNextPage === 'boolean') {
      hasNext = resp.hasNextPage;
    } else {
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

const _VALID_TAG_ID = 1;
const INVALID_TAG_ID = 2;

export type CheckAccountResult =
  | { ok: true; valid: boolean; tags: AccountTag[]; reason?: string }
  | { ok: false; message: string };

const tagsToResult = (tags: AccountTag[], reason?: string): CheckAccountResult => {
  const valid = !tags.some((tag) => tag.id === INVALID_TAG_ID);
  return { ok: true, valid, tags, reason };
};

const fetchAuthoritativeTags = async (itemId: number): Promise<AccountTag[] | null> => {
  try {
    const resp = await getClient().getItem(itemId);
    if (resp?.item) return extractTags(resp.item);
  } catch (err) {
    log.warn(`[market] checkAccount getItem(${itemId}) failed`, err);
  }
  return null;
};

export const checkAccountValidity = async (itemId: number): Promise<CheckAccountResult> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const resp = await getClient().checkAccount(itemId);
      const errors = 'errors' in resp && Array.isArray(resp.errors) ? resp.errors : [];
      if (errors.includes('retry_request')) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const reason = typeof errors[0] === 'string' ? errors[0] : undefined;
      if (reason) log.warn(`[market] checkAccount(${itemId}) error: ${reason}`);
      const tags = await fetchAuthoritativeTags(itemId);
      if (tags) return tagsToResult(tags, reason);
      return { ok: false, message: reason ?? 'check_failed' };
    } catch (err) {
      log.warn(`[market] checkAccount(${itemId}) threw`, err);
      return { ok: false, message: err instanceof Error ? err.message : 'check_failed' };
    }
  }
  return { ok: false, message: 'retry_request' };
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

const pickLoginRaw = (item: RawMarketItem, serviceId: ServiceId | null): string | null => {
  const ld = item.loginData;
  const fromLoginData =
    ld && typeof ld === 'object' ? asTrimmedString((ld as { login?: unknown }).login) : null;
  const fromAccountLogin = asTrimmedString(item.account_login);

  if (serviceId === 'telegram') {
    return asTrimmedString(item.telegram_phone) ?? null;
  }
  return fromLoginData ?? fromAccountLogin;
};

const pickPasswordRaw = (item: RawMarketItem, serviceId: ServiceId | null): string | null => {
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
    const resp = await getClient().getItem(itemId);
    const item = resp.item;
    if (!item) return null;
    const summary = normalizeItem(item);
    const loginRaw = pickLoginRaw(item, summary.category);
    const passwordRaw = pickPasswordRaw(item, summary.category);
    log.debug(
      `[market] item #${itemId} category=${summary.categoryRaw} ` +
        `loginRaw=${loginRaw ? 'present' : 'missing'} ` +
        `passwordRaw=${passwordRaw ? 'present' : 'missing'}`,
    );
    return {
      ...summary,
      loginRaw,
      passwordRaw,
      secrets: item,
    };
  } catch (err) {
    log.warn('[market] getAccountDetails failed', err);
    return null;
  }
};
