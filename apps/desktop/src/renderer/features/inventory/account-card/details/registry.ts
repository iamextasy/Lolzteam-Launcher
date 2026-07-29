import type { ComponentType } from 'react';
import { SteamDetails } from './SteamDetails';
import { TelegramDetails } from './TelegramDetails';
import type { AccountDetailsProps } from './types';

/**
 * Parsed-info panels, in render order. A panel renders nothing when the account
 * carries no payload for it, so describing a new service means adding one entry
 * here and nothing else.
 */
export const DETAILS_PANELS: Array<{
  id: string;
  Panel: ComponentType<AccountDetailsProps>;
}> = [
  { id: 'steam', Panel: SteamDetails },
  { id: 'telegram', Panel: TelegramDetails },
];
