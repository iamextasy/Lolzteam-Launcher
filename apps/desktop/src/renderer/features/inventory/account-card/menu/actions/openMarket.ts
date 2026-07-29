import { ExternalLink } from 'lucide-react';
import type { AccountAction } from '../types';

export const openMarketAction: AccountAction = {
  id: 'open-market',
  icon: ExternalLink,
  labelKey: 'inventory.card.openOnMarket',
  onSelect: (card) => {
    void window.launcher.app.openExternal(`https://lzt.market/${card.item.itemId}/`);
  },
};
