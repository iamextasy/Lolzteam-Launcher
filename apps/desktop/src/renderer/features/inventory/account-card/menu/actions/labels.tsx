import type { UserLabel } from '@shared-types';
import { Check, ExternalLink, Loader2, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labelColors } from '~/lib/labelColor';
import { useProfileLabels } from '~/stores/profileLabels';
import { Modal } from '~/widgets/Modal/Modal';
import s from '../../AccountCard.module.scss';
import { useAccountCard } from '../../AccountCardContext';
import type { AccountAction, AccountActionOverlayProps } from '../types';

const NO_PENDING: ReadonlySet<number> = new Set();

const LabelsOverlay = ({ onClose }: AccountActionOverlayProps) => {
  const { t } = useTranslation();
  const { item, updateTags } = useAccountCard();
  const labels = useProfileLabels((p) => p.labels);
  const loading = useProfileLabels((p) => p.loading);
  const [pending, setPending] = useState<ReadonlySet<number>>(NO_PENDING);

  useEffect(() => {
    void useProfileLabels.getState().load();
  }, []);

  const toggle = async (label: UserLabel) => {
    if (pending.has(label.id)) return;
    const attached = (item.tags ?? []).some((tag) => tag.id === label.id);
    setPending((prev) => new Set(prev).add(label.id));
    try {
      const res = attached
        ? await window.launcher.accounts.removeTag(item.itemId, label.id)
        : await window.launcher.accounts.addTag(item.itemId, label.id);
      if (res.ok) {
        updateTags((tags) => {
          if (attached) return tags.filter((tag) => tag.id !== label.id);
          if (tags.some((tag) => tag.id === label.id)) return tags;
          return [...tags, { id: label.id, title: label.title, bc: label.bc }];
        });
      }
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(label.id);
        return next;
      });
    }
  };

  return (
    <Modal title={t('inventory.card.labelsTitle')} closable onClose={onClose}>
      {loading && labels.length === 0 ? (
        <div className={s.labelsLoading}>
          <Loader2 size={28} className={s.spin} />
        </div>
      ) : labels.length === 0 ? (
        <div className={s.labelsEmpty}>
          <p className={s.checkText}>{t('inventory.card.labelsEmpty')}</p>
          <button
            type="button"
            className={s.labelsWebBtn}
            onClick={() => void window.launcher.app.openExternal('https://lzt.market/tags/')}
          >
            <ExternalLink size={14} />
            <span>{t('inventory.card.labelsManageWeb')}</span>
          </button>
        </div>
      ) : (
        <ul className={s.labelsList}>
          {labels.map((label) => {
            const attached = (item.tags ?? []).some((tag) => tag.id === label.id);
            const busy = pending.has(label.id);
            const c = labelColors(label.bc);
            return (
              <li key={label.id}>
                <button
                  type="button"
                  className={`${s.labelRow} ${attached ? s.labelRowOn : ''}`}
                  onClick={() => void toggle(label)}
                  disabled={busy}
                  aria-pressed={attached}
                >
                  <span
                    className={s.labelChip}
                    style={{ backgroundColor: c.background, color: c.text }}
                  >
                    {label.title}
                  </span>
                  <span className={s.labelState}>
                    {busy ? (
                      <Loader2 size={16} className={s.spin} />
                    ) : attached ? (
                      <Check size={16} />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

export const labelsAction: AccountAction = {
  id: 'labels',
  icon: Tags,
  labelKey: 'inventory.card.labelsMenu',
  Overlay: LabelsOverlay,
};
