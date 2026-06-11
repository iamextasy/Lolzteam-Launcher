import type { ServiceId } from './service-id';

export interface SteamGame {
  appId: number;
  /** Icon lives at https://nztcdn.com/steam/icon/{parentGameId}.webp */
  parentGameId: number;
  title: string;
  /** Total hours played (the API already reports this in hours). */
  hours: number;
}

export interface AccountTag {
  id: number;
  title: string;
  bc?: string;
}

export interface UserLabel {
  id: number;
  title: string;
  bc: string;
  isDefault: boolean;
  forOwnedAccountsOnly: boolean;
}

export type MarketCurrency =
  | 'rub'
  | 'uah'
  | 'kzt'
  | 'byn'
  | 'usd'
  | 'eur'
  | 'gbp'
  | 'cny'
  | 'try'
  | 'jpy'
  | 'brl';

export const MARKET_CURRENCIES: readonly MarketCurrency[] = [
  'rub',
  'uah',
  'kzt',
  'byn',
  'usd',
  'eur',
  'gbp',
  'cny',
  'try',
  'jpy',
  'brl',
];

export interface SteamInfo {
  tags: AccountTag[];
  level: number | null;
  gameCount: number | null;
  /** Steam Desktop Authenticator / mafile guard present. */
  hasMfa: boolean;
  isLimited: boolean;
  /** Last activity, unix seconds. */
  lastActivity: number | null;
  vacBanned: boolean;
  communityBanned: boolean;
  tradeBanned: boolean;
  /** Human-readable balance as the API renders it (e.g. "0₴"). */
  balance: string | null;
  /** Balance converted to the viewer's account currency (matches item currency). */
  convertedBalance: number | null;
  /** Pending balance converted to the viewer's account currency. */
  convertedPendingBalance: number | null;
  /** Steam points balance. */
  points: number | null;
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  /** ISO 3166 alpha-2 country code, e.g. "US". */
  country: string | null;
  /** Top games by hours, icons resolvable via parentGameId. */
  games: SteamGame[];
}

export interface TelegramInfo {
  /** Phone in raw digits (no leading +). */
  phone: string | null;
  username: string | null;
  /** Telegram user id. */
  id: number | null;
  /** ISO 3166 alpha-2 country code, e.g. "US". */
  country: string | null;
  /** Last seen, unix seconds. */
  lastSeen: number | null;
  /** Active Premium subscription. */
  premium: boolean;
  /** Premium expiry, unix seconds. */
  premiumExpires: number | null;
  /** True when the account is under a spam block. */
  spamBlocked: boolean;
  tags: AccountTag[];
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  channelsCount: number | null;
  chatsCount: number | null;
  contactsCount: number | null;
}

export interface AccountSummary {
  itemId: number;
  category: ServiceId | null;
  categoryRaw: string;
  categoryTitle: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  tags: AccountTag[];
  warrantyEndsAt: number | null;
  publishedAt: number | null;
  /** When the buyer purchased the item, unix seconds. Null if unknown. */
  purchasedAt: number | null;
  isPurchased: boolean;
  /** Present only for Steam items; null when fields are unavailable. */
  steam: SteamInfo | null;
  /** Present only for Telegram items; null when fields are unavailable. */
  telegram: TelegramInfo | null;
}

export interface AccountDetails extends AccountSummary {
  loginRaw: string | null;
  passwordRaw: string | null;
  secrets: Record<string, unknown>;
}
