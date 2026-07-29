import type { AccountSummary } from '@shared-types';
import { createContext, useContext } from 'react';
import type { LoginService } from '~/stores/loginSession';
import type { AccountLoginFlow } from './useAccountLogin';
import type { TagsTransform } from './useAccountTags';

/**
 * Everything a card part or a menu action may need. Parts read it from context
 * instead of receiving it through props, so new actions don't widen any
 * signature on the way down.
 */
export interface AccountCardApi {
  item: AccountSummary;
  /** Login backend this account maps to; null when the category has no adapter. */
  service: LoginService | null;
  isInvalid: boolean;
  /** Formatted remaining warranty, or null when none is active. */
  warranty: string | null;
  login: AccountLoginFlow;
  updateTags: (transform: TagsTransform) => void;
}

const AccountCardContext = createContext<AccountCardApi | null>(null);

export const AccountCardProvider = AccountCardContext.Provider;

export const useAccountCard = (): AccountCardApi => {
  const api = useContext(AccountCardContext);
  if (!api) throw new Error('useAccountCard must be called inside an AccountCard');
  return api;
};
