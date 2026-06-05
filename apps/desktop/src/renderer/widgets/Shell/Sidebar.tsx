import { Boxes, Settings, ShoppingBag, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type ViewId, useView } from '~/stores/view';
import s from './Sidebar.module.scss';

interface NavItem {
  id: string;
  labelKey: string;
  icon: typeof Boxes;
  view?: ViewId;
}

const NAV: readonly NavItem[] = [
  { id: 'inventory', labelKey: 'sidebar.inventory', icon: Boxes, view: 'inventory' },
  { id: 'market', labelKey: 'sidebar.market', icon: ShoppingBag },
  { id: 'wallet', labelKey: 'sidebar.wallet', icon: Wallet },
  { id: 'settings', labelKey: 'sidebar.settings', icon: Settings, view: 'settings' },
] as const;

export const Sidebar = () => {
  const { t } = useTranslation();
  const view = useView((st) => st.view);
  const setView = useView((st) => st.setView);

  return (
    <nav className={s.dock} aria-label="Primary">
      {NAV.map((item) => {
        const Icon = item.icon;
        const viewId = item.view;
        const enabled = viewId !== undefined;
        const active = enabled && view === viewId;
        return (
          <button
            key={item.id}
            type="button"
            className={`${s.navItem} ${active ? s.navItemActive : ''}`}
            disabled={!enabled}
            onClick={enabled ? () => setView(viewId) : undefined}
          >
            <Icon size={18} />
            <span>{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
};
