import type { LoginService } from '~/stores/loginSession';
import { checkValidityAction } from './actions/checkValidity';
import { labelsAction } from './actions/labels';
import { loginViaBrowserAction } from './actions/loginViaBrowser';
import { openEmailAction } from './actions/openEmail';
import { openMarketAction } from './actions/openMarket';
import { transferGiftsAction } from './actions/transferGifts';
import type { AccountAction } from './types';

/** Offered for every account, below the service-specific entries. */
const SHARED_ACTIONS: AccountAction[] = [
  openEmailAction,
  checkValidityAction,
  labelsAction,
  openMarketAction,
];

/**
 * Service-specific menu entries. This is the single place the menu grows: add a
 * Steam-only action to `steam`, an LLM-only one to `llm`, and nothing else in
 * the card has to change.
 */
const SERVICE_ACTIONS: Partial<Record<LoginService, AccountAction[]>> = {
  steam: [loginViaBrowserAction, transferGiftsAction],
  llm: [loginViaBrowserAction],
};

const cache = new Map<LoginService | 'unsupported', AccountAction[]>();

/** Actions for a service, in menu order. The result is shared across cards. */
export const actionsFor = (service: LoginService | null): AccountAction[] => {
  const key = service ?? 'unsupported';
  let actions = cache.get(key);
  if (!actions) {
    actions = service ? [...(SERVICE_ACTIONS[service] ?? []), ...SHARED_ACTIONS] : SHARED_ACTIONS;
    cache.set(key, actions);
  }
  return actions;
};
