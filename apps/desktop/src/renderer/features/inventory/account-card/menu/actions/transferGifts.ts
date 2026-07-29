import { Gift } from 'lucide-react';
import type { AccountAction } from '../types';
import { TransferGiftsOverlay } from './transferGifts/TransferGiftsOverlay';

export const transferGiftsAction: AccountAction = {
  id: 'transfer-gifts',
  icon: Gift,
  labelKey: 'inventory.card.transferGifts',
  Overlay: TransferGiftsOverlay,
};
