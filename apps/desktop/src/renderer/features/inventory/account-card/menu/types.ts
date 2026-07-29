import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { AccountCardApi } from '../AccountCardContext';

export interface AccountActionOverlayProps {
  onClose: () => void;
}

/**
 * One entry of the card's "…" menu. An action gets the whole card API, so it
 * never needs new props threaded down, and it may bring its own modal along.
 */
export interface AccountAction {
  id: string;
  icon: LucideIcon;
  /** i18n key of the menu label. */
  labelKey: string;
  /** Hidden entirely when this returns false. Defaults to visible. */
  isVisible?: (card: AccountCardApi) => boolean;
  /** Rendered greyed out when this returns true. Defaults to enabled. */
  isDisabled?: (card: AccountCardApi) => boolean;
  /** Runs on click, right after the menu closes. */
  onSelect?: (card: AccountCardApi) => void;
  /**
   * Modal owned by this action. It is mounted by the card (not by the menu), so
   * it survives the menu closing, and unmounts through `onClose`.
   */
  Overlay?: ComponentType<AccountActionOverlayProps>;
}
