import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from '../AccountCard.module.scss';
import { useAccountCard } from '../AccountCardContext';
import { actionsFor } from '../menu/registry';
import type { AccountAction } from '../menu/types';

const EMPTY_ACTIONS: AccountAction[] = [];

const MORE_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12C11 12.5523 11.4477 13 12 13Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19 13C19.5523 13 20 12.5523 20 12C20 11.4477 19.5523 11 19 11C18.4477 11 18 11.4477 18 12C18 12.5523 18.4477 13 19 13Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 13C5.55228 13 6 12.5523 6 12C6 11.4477 5.55228 11 5 11C4.44772 11 4 11.4477 4 12C4 12.5523 4.44772 13 5 13Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The "…" menu. Entries come from the action registry, so the card itself knows
 * nothing about what Steam or LLM accounts can do. An entry's modal is mounted
 * here rather than inside the dropdown, so it outlives the menu closing.
 */
export const AccountActions = () => {
  const { t } = useTranslation();
  const card = useAccountCard();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<AccountAction | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const actions = open
    ? actionsFor(card.service).filter((action) => action.isVisible?.(card) ?? true)
    : EMPTY_ACTIONS;

  const select = (action: AccountAction) => {
    setOpen(false);
    action.onSelect?.(card);
    if (action.Overlay) setActive(action);
  };

  const Overlay = active?.Overlay;

  return (
    <div className={s.menuWrap} ref={wrapRef}>
      <Tooltip label={t('inventory.card.menuTooltip')}>
        <button
          type="button"
          className={s.menuAccount}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {MORE_ICON}
        </button>
      </Tooltip>
      {open ? (
        <div className={s.menu} role="menu">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={s.menuItem}
              role="menuitem"
              onClick={() => select(action)}
              disabled={action.isDisabled?.(card) ?? false}
            >
              <action.icon size={16} />
              <span>{t(action.labelKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {Overlay ? <Overlay onClose={() => setActive(null)} /> : null}
    </div>
  );
};
