import { Mail } from 'lucide-react';
import { useMailTarget } from '~/stores/mailTarget';
import { useView } from '~/stores/view';
import type { AccountAction } from '../types';

/** Hands the inbox credentials to the Mail page, which fetches letters over the API. */
const openInbox = async (itemId: number): Promise<void> => {
  try {
    const details = await window.launcher.accounts.get(itemId);
    const secrets = (details?.secrets ?? {}) as Record<string, unknown>;
    const eld = (secrets.emailLoginData ?? secrets.email_login_data) as
      | { login?: string; password?: string }
      | undefined;
    const login = eld?.login ?? (secrets.account_login as string | undefined);
    const password = eld?.password ?? (secrets.account_password as string | undefined);
    if (!login || !password) return;
    useMailTarget.getState().setPending(`${login}:${password}`);
    useView.getState().setView('mail');
  } catch {
    // ignore — nothing to open
  }
};

export const openEmailAction: AccountAction = {
  id: 'email',
  icon: Mail,
  labelKey: 'inventory.card.emailMenu',
  isVisible: (card) => card.item.hasEmailLogin,
  onSelect: (card) => {
    void openInbox(card.item.itemId);
  },
};
