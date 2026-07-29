import type { AccountTag } from '@shared-types';
import { AlertTriangle, Ban, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '~/widgets/Modal/Modal';
import s from '../../AccountCard.module.scss';
import { useAccountCard } from '../../AccountCardContext';
import type { AccountAction, AccountActionOverlayProps } from '../types';

type CheckState =
  | { status: 'pending' }
  | { status: 'done'; valid: boolean; reason?: string }
  | { status: 'error'; message: string | null };

const CheckValidityOverlay = ({ onClose }: AccountActionOverlayProps) => {
  const { t } = useTranslation();
  const { item, updateTags } = useAccountCard();
  const [state, setState] = useState<CheckState>({ status: 'pending' });
  const freshTags = useRef<AccountTag[] | null>(null);

  useEffect(() => {
    let alive = true;
    window.launcher.accounts
      .check(item.itemId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          freshTags.current = res.tags;
          setState({ status: 'done', valid: res.valid, reason: res.reason });
        } else {
          setState({ status: 'error', message: res.message });
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({ status: 'error', message: err instanceof Error ? err.message : null });
        }
      });
    return () => {
      alive = false;
    };
  }, [item.itemId]);

  // The check reports the account's current tags. Applying them on close keeps
  // the card from changing under the result the user is still reading.
  const close = () => {
    const tags = freshTags.current;
    if (tags) updateTags(() => tags);
    onClose();
  };

  return (
    <Modal title={t('inventory.card.checkTitle')} onClose={close}>
      <div className={s.checkBody}>
        {state.status === 'pending' ? (
          <div className={s.checkPending}>
            <Loader2 size={32} className={s.spin} />
            <p className={s.checkText}>{t('inventory.card.checking')}</p>
          </div>
        ) : state.status === 'error' ? (
          <div className={`${s.checkResult} ${s.checkResultWarn}`}>
            <AlertTriangle size={32} />
            <p className={s.checkText}>{t('inventory.card.checkErrorBody')}</p>
            <p className={s.checkSub}>{state.message ?? t('inventory.card.callError')}</p>
          </div>
        ) : state.valid ? (
          <div className={`${s.checkResult} ${s.checkResultOk}`}>
            <CheckCircle2 size={32} />
            <p className={s.checkText}>{t('inventory.card.checkValidResult')}</p>
          </div>
        ) : (
          <div className={`${s.checkResult} ${s.checkResultBad}`}>
            <Ban size={32} />
            <p className={s.checkText}>{t('inventory.card.checkInvalidResult')}</p>
            {state.reason ? <p className={s.checkSub}>{state.reason}</p> : null}
          </div>
        )}
      </div>
      <div className={s.warnActions}>
        <button type="button" className={s.warnConfirm} onClick={close}>
          {t('inventory.card.checkClose')}
        </button>
      </div>
    </Modal>
  );
};

export const checkValidityAction: AccountAction = {
  id: 'check-validity',
  icon: ShieldCheck,
  labelKey: 'inventory.card.checkValidity',
  Overlay: CheckValidityOverlay,
};
