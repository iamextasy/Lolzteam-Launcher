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

export type RawMarketLoginData = Record<string, unknown> | null;
export type RawMarketBooleanLike = boolean | number | string | null;
export type RawMarketBans = Record<string, unknown> | null;

export interface RawMarketItem {
  item_id: number;
  category_id: number;
  item_state: string;
  price: number;
  price_currency: string;
  title?: string;
  title_en?: string;
  description?: string;
  account_login?: string;
  account_password?: string;
  loginData?: RawMarketLoginData;
  telegram_password_value?: string;
  telegram_phone?: string;
  telegram_username?: string;
  telegram_id?: number | string;
  telegram_country?: string;
  telegram_last_seen?: number | string;
  telegram_premium?: RawMarketBooleanLike;
  telegram_premium_expires?: number | string;
  telegram_spam_block?: RawMarketBooleanLike;
  telegram_channels_count?: number | string;
  telegram_chats_count?: number | string;
  telegram_contacts_count?: number | string;
  steam_country?: string;
  steam_id?: string;
  steam_level?: number | string;
  steam_balance?: number | string | null;
  steam_converted_balance?: number | string | null;
  steam_converted_pending_balance?: number | string | null;
  steam_points?: number | string | null;
  steam_mfa?: RawMarketBooleanLike;
  steam_is_limited?: RawMarketBooleanLike;
  steam_last_activity?: number | string;
  steam_game_count?: number | string;
  steam_full_games?: RawMarketSteamFullGames | unknown;
  steam_vac?: RawMarketBooleanLike;
  steam_community_ban?: RawMarketBooleanLike;
  steam_trade_ban?: RawMarketBooleanLike;
  steam_bans?: RawMarketBans;
  itemOriginPhrase?: string;
  warranty_end_at?: number;
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
  /** Authoritative "more pages?" flag from the API. */
  hasNextPage: boolean;
  perPage: number;
  page: number;
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
