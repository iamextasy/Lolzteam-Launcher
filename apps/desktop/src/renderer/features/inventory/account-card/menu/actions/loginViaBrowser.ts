import { Globe } from 'lucide-react';
import type { AccountAction } from '../types';

/** Signs in through the embedded browser instead of the service's native client. */
export const loginViaBrowserAction: AccountAction = {
  id: 'login-via-browser',
  icon: Globe,
  labelKey: 'inventory.card.loginViaBrowser',
  isVisible: (card) => card.login.canLogin,
  isDisabled: (card) => card.login.busy,
  onSelect: (card) => card.login.startWithMethod('web'),
};
