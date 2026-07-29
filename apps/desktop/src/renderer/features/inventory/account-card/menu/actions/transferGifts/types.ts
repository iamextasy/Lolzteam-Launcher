export interface GiftItem {
  id: string;
  name: string;
  marketHashName: string;
  iconUrl: string | null;
  timed: boolean;
  regional: boolean;
  /** Plain-text countries from Steam fraudwarnings (not ISO tags). */
  restrictionCountries: string | null;
}

export type WizardStep =
  | 'proxy'
  | 'loading'
  | 'empty'
  | 'error'
  | 'select'
  | 'destination'
  | 'confirm'
  | 'progress'
  | 'done';

export type SelectMode = 'tiles' | 'filters';
export type DestKind = 'email' | 'invite';

export interface GiftPair {
  gift: GiftItem;
  recipient: string;
}

export interface TransferResult {
  okCount: number;
  failCount: number;
  errors: Array<{ giftName: string; recipient: string; message: string }>;
}

export const nonEmptyLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isLikelyEmail = (value: string): boolean => EMAIL_RE.test(value);

/** Quick-invite URL shape: s.team/p/{code}/{token} or steamcommunity.com/user/... */
const INVITE_RE =
  /^(?:https?:\/\/)?(?:s\.team\/p|steamcommunity\.com\/user)\/[bcdfghjkmnpqrtvw0-9a-f\-]+\/[A-Za-z0-9_-]+$/i;

export const isLikelyInviteLink = (value: string): boolean => INVITE_RE.test(value.trim());
