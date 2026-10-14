export interface RawMarketTagEntry {
  tag_id?: number | string;
  title?: string;
  [key: string]: unknown;
}

export type RawMarketTags = Record<string, RawMarketTagEntry> | RawMarketTagEntry[] | null;

export type RawMarketBuyer = { operation_date?: number | string } | Record<string, unknown>;

export interface RawMarketSteamGameRecord {
  appid?: number | string;
  parentGameId?: number | string;
  abbr?: string;
  title?: string;
  playtime_forever?: number | string;
  [key: string]: unknown;
}

export interface RawMarketSteamFullGames {
  list?: Record<string, RawMarketSteamGameRecord> | RawMarketSteamGameRecord[] | null;
  [key: string]: unknown;
}

/** `telegram_group_counters` — the spec's grouped form of the flat `*_count`s. */
export interface RawMarketTelegramGroupCounters {
  chats?: number | string;
  channels?: number | string;
  conversations?: number | string;
  admin?: number | string;
  [key: string]: unknown;
}

export type RawMarketLoginData = Record<string, unknown> | null;
export type RawMarketBooleanLike = boolean | number | string | null;

/** `steam_bans` is declared `string` in the market OpenAPI spec: Steam's own `GetPlayerBans` payload, JSON-encoded. */
export type RawMarketBans = string | Record<string, unknown> | null;

/** Per-category item fields, as declared in the market OpenAPI spec under the `/steam`, `/telegram`, `/discord`. */
export interface RawMarketItem {
  item_id: number;
  category_id: number;
  item_state: string;
  /** Own listings: hours between automatic bumps, absent or 0 when off. */
  auto_bump_period?: number;
  /** Own listings: how long the guarantee runs, in seconds. */
  guarantee_duration?: number;
  /** Own listings: the editable fields, as the market currently holds them. */
  allow_ask_discount?: boolean | number;
  item_origin?: string;
  email_type?: string;
  /** Own listings: what the market lets the seller do to this item right now. */
  canOpenItem?: boolean;
  canCloseItem?: boolean;
  canEditItem?: boolean;
  canDeleteItem?: boolean;
  canStickItem?: boolean;
  canUnstickItem?: boolean;
  canBumpItem?: boolean;
  canAutoBump?: boolean;
  /** Why a bump is refused — the market's own sentence, with markup in it. */
  canNotBumpItemReason?: string;
  price: number;
  price_currency: string;
  title?: string;
  title_en?: string;
  description?: string;
  account_login?: string;
  account_password?: string;
  loginData?: RawMarketLoginData;
  /** Present when the account ships a viewable email inbox (login:password). */
  emailLoginData?: { login?: string; password?: string; raw?: string };
  email_login_data?: { login?: string; password?: string; raw?: string };
  canViewEmailLoginData?: boolean;
  can_view_email_login_data?: boolean;
  /** Telegram credentials. */
  telegram_password_value?: string;
  telegram_phone?: string;
  telegram_username?: string;
  telegram_id?: number | string;
  telegram_country?: string;
  telegram_last_seen?: number | string;
  telegram_premium?: RawMarketBooleanLike;
  telegram_premium_expires?: number | string;
  telegram_spam_block?: RawMarketBooleanLike;
  telegram_password?: RawMarketBooleanLike;
  telegram_stars_count?: number | string;
  telegram_birthday?: number | string;
  telegram_channels_count?: number | string;
  telegram_chats_count?: number | string;
  telegram_admin_count?: number | string;
  telegram_admin_subs_count?: number | string;
  telegram_conversations_count?: number | string;
  telegram_contacts_count?: number | string;
  telegram_group_counters?: RawMarketTelegramGroupCounters;
  steam_country?: string;
  steam_id?: string;
  steam_level?: number | string;
  /** Rendered balance with its currency sign, e.g. "0₴". */
  steam_balance?: string | null;
  steam_converted_balance?: number | string;
  steam_inv_value?: number | string;
  steam_mfa?: RawMarketBooleanLike;
  steam_is_limited?: RawMarketBooleanLike;
  steam_limit_spent?: string | number | null;
  steam_last_activity?: number | string;
  steam_register_date?: number | string;
  steam_last_transaction_date?: number | string;
  steam_game_count?: number | string;
  steam_friend_count?: number | string;
  steam_gift_count?: number | string;
  steam_points?: number | string;
  steam_faceit_level?: number | string;
  steam_hours_played_recently?: string | number | null;
  steam_full_games?: RawMarketSteamFullGames | unknown;
  steam_community_ban?: RawMarketBooleanLike;
  steam_bans?: RawMarketBans;
  steam_cs2_ban_date?: number | string;
  steam_cs2_ban_date_active?: boolean;
  steam_market_ban_end_date?: number | string;
  /** A trade ban that never lifts. */
  steamLifetimeTradeBan?: boolean;
  /** Perfect World (China) account — its CS2 copy will not run elsewhere. */
  chineseAccount?: boolean;
  discord_verified?: RawMarketBooleanLike;
  discord_billing?: RawMarketBooleanLike;
  discord_condition?: string;
  discord_gifts?: number | string;
  discord_locale?: string;
  discord_chat_count?: number | string;
  discord_register_date?: number | string;
  discord_nitro_end_date?: number | string;
  discord_nitro_type?: number | string;
  discord_available_boosts?: number | string;
  discord_admin_servers_count?: number | string;
  discord_admin_members_count?: number | string;
  /** Ready-made display strings the market renders on the web card itself. */
  discordAccountConditionLabel?: string;
  discordLocaleTitle?: string;
  discordNitroType?: string;
  /** `instagram_item_id` is deliberately absent: it repeats `item_id`. */
  instagram_id?: number | string;
  instagram_username?: string;
  /** Empty far more often than not, and a *name* rather than a code when set. */
  instagram_country?: string;
  instagram_follower_count?: number | string;
  instagram_follow_count?: number | string;
  instagram_post_count?: number | string;
  instagram_register_date?: number | string;
  /** A phone number is attached to the account. */
  instagram_mobile?: RawMarketBooleanLike;
  /** Session cookies ship with the item — what the browser login logs in with. */
  instagram_has_cookies?: RawMarketBooleanLike;
  /** The seller says login:password works on its own, cookies or not. */
  instagram_login_without_cookies?: RawMarketBooleanLike;
  /** `tiktok_item_id` is absent for the same reason `instagram_item_id` is: it repeats `item_id`. */
  tiktok_unique_id?: string;
  tiktok_screen_name?: string;
  /** Empty far more often than not, and a *name* rather than a code when set. */
  tiktok_top_country?: string;
  tiktok_followers?: number | string;
  tiktok_following?: number | string;
  tiktok_likes?: number | string;
  tiktok_videos?: number | string;
  /** Coin balance — TikTok's own currency for gifts. */
  tiktok_coins?: number | string;
  /** Account creation date, unix seconds. */
  tiktok_create_time?: number | string;
  tiktok_verified?: RawMarketBooleanLike;
  tiktok_private_account?: RawMarketBooleanLike;
  tiktok_has_email?: RawMarketBooleanLike;
  tiktok_has_mobile?: RawMarketBooleanLike;
  /** Live streaming is unlocked (TikTok gates it behind a follower count). */
  tiktok_can_stream?: RawMarketBooleanLike;
  /** …and from LIVE Studio, which is gated separately and is what streamers want. */
  tiktok_can_stream_studio?: RawMarketBooleanLike;
  /** LLM items (category 6). */
  llm_service?: string;
  llm_id?: string;
  llm_register_date?: number | string;
  /** Plan code as the market spells it. */
  llm_subscription?: string;
  llm_subscription_ends?: number | string;
  llm_subscription_auto_renew?: RawMarketBooleanLike;
  /** Session cookies shipped with the item. */
  llm_cookies?: unknown;
  /** Share of the plan's quota already spent, 0…100. */
  llm_usage_percent?: number | string | null;
  /** Rendered balance with its currency sign, like `steam_balance`. */
  llm_balance?: string | null;
  llm_converted_balance?: number | string | null;
  /** Identity check passed on the provider's side. */
  llm_kyc_verified?: RawMarketBooleanLike;
  llm_phone?: RawMarketBooleanLike;
  itemOriginPhrase?: string;
  /** The owner's private note on the item — what `PUT /{item_id}/note` writes. */
  note_text?: string | null;
  /** The old field the API no longer fills; kept as a fallback. */
  warranty_end_at?: number;
  /** What the item page actually renders its warranty badge from. */
  guarantee?: {
    /** Seconds. */
    duration?: number;
    class?: string;
    /** «3 дня», as the market phrases it. */
    durationPhrase?: string;
    /** Unix seconds; `null` until the item is sold. */
    endDate?: number | null;
    active?: boolean | null;
    cancelled?: boolean | null;
    /** Seconds left, as the server counts. */
    remainingTime?: number | null;
    [key: string]: unknown;
  };
  published_date?: number;
  category?: {
    name?: string;
    title?: string;
    category_name?: string;
    category_title?: string;
    [key: string]: unknown;
  } | null;
  category_name?: string;
  category_title?: string;
  tags?: RawMarketTags;
  buyer?: RawMarketBuyer;
  item_image?: string;
  item_image_url?: string;
  [key: string]: unknown;
}

export interface RawOrdersResponse {
  items: RawMarketItem[];
  totalItems: number;
  /**
   * The link to the next page, `null` on the last one. The only way forward
   * once numbered paging is gone — read it with `readNextPage`.
   */
  nextPageHref?: string | null;
  /** "More pages?" — the fallback for a response without `nextPageHref`. */
  hasNextPage: boolean;
  perPage: number;
  page?: number;
  /** Carries `rate_limit`, among other things. */
  system_info?: unknown;
}

/** How much of the current rate-limit window is left, as the server itself reports it. */
export interface RateLimitInfo {
  /** Requests allowed in the window. */
  limit: number;
  /** Requests still available in it. */
  remaining: number;
  /** Unix time, in **seconds**, at which the counter rolls over. */
  reset: number;
}

export interface EmailCodeData {
  code: string;
  date: number;
  textPlain?: string;
}

export type EmailCodeResponse =
  | { item?: RawMarketItem; codeData: EmailCodeData }
  | { error: string; errors?: string[] | string };

export type CheckAccountResponse = { status: string; item: RawMarketItem } | { errors: string[] };

export interface RawProfileResponse {
  user: {
    user_id: number;
    username: string;
    avatar_url?: string | null;
    view_url?: string | null;
    // Forum API returns balance as a string ("496910.40"); market API as a number.
    balance?: number | string;
    convertedBalance?: number | string;
    currency?: string;
    currencyPhrase?: string;
    tags?: Array<{
      tag_id: number;
      title: string;
      bc?: string;
      isDefault?: boolean;
      forOwnedAccountsOnly?: boolean;
    }>;
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

export interface RawTagOpResponse {
  itemId?: number;
  tag?: { title: string; bc?: string; tag_id: number; forOwnedAccountsOnly?: boolean } | null;
  addedTagId?: number;
  deleteTags?: number[];
  errors?: string[] | string;
  [key: string]: unknown;
}

export interface RawEditMeResponse {
  user?: Record<string, unknown>;
  errors?: string[] | string;
  [key: string]: unknown;
}

export interface RawUserTag {
  tag_id: number;
  title: string;
  bc?: string;
  forOwnedAccountsOnly?: boolean;
  isDefault?: boolean;
}

export interface RawUserTagsResponse {
  tags?: RawUserTag[];
  errors?: string[] | string;
  [key: string]: unknown;
}

export interface RawUserTagResponse {
  tag?: RawUserTag | null;
  errors?: string[] | string;
  [key: string]: unknown;
}

export interface RawStatusResponse {
  status?: string;
  message?: string;
  errors?: string[] | string;
  [key: string]: unknown;
}

export interface RawLetter {
  id?: number | string;
  subject?: string;
  title?: string;
  from?: string;
  sender?: string;
  to?: string;
  date?: number | string;
  timestamp?: number | string;
  textPlain?: string;
  text?: string;
  body?: string;
  textHtml?: string;
  html?: string;
  [key: string]: unknown;
}

export interface RawLettersResponse {
  letters?: RawLetter[];
  items?: RawLetter[];
  error?: string;
  errors?: string[] | string;
  [key: string]: unknown;
}

/** `GET /{item_id}/guard-code` — the market's wording of `codeData` is loose, so every field is optional. */
export interface RawGuardCodeResponse {
  codeData?: {
    code?: string;
    date?: number;
    [key: string]: unknown;
  };
  code?: string;
  errors?: string[] | string;
  [key: string]: unknown;
}

/** `GET /{item_id}/ai-price` — the suggestion, already in the user's currency. */
export interface RawAiPriceResponse {
  price?: number;
  errors?: string[] | string;
  [key: string]: unknown;
}

/** `GET /{item_id}/auto-buy-price` — the same shape, for the auto-buy figure. */
export type RawAutoBuyPriceResponse = RawAiPriceResponse;

/** The edit payload lives in shared-types: the IPC layer needs it too. */
export type { ItemEditFields, ItemOrigin } from '@lolzteam/shared-types';

/** One finished market API call, as the API monitor sees it. */
export interface ApiCallRecord {
  /** Epoch ms of the response. */
  at: number;
  method: string;
  /** Path relative to the API root, e.g. `user/orders`. */
  path: string;
  status: number;
  durationMs: number;
  /** The `X-RateLimit-*` trio, when the response carried it. */
  limit?: number;
  remaining?: number;
  /** Unix seconds. */
  reset?: number;
}
