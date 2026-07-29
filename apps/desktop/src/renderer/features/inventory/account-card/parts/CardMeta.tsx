import type { AccountSummary } from '@shared-types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import s from '../AccountCard.module.scss';
import { formatPrice, formatPurchasedAgo } from '../lib/format';

interface CardMetaProps {
  item: AccountSummary;
  warranty: string | null;
}

const CardMetaImpl = ({ item, warranty }: CardMetaProps) => {
  const { t, i18n } = useTranslation();
  const purchased = item.purchasedAt
    ? formatPurchasedAgo(item.purchasedAt, t, i18n.language)
    : null;

  return (
    <div className={s.bottomGroup}>
      {purchased ? (
        <div className={s.bottomItem}>
          <span className={s.description}>{t('inventory.card.purchasedLabel')}</span>
          <span className={s.title}>{purchased}</span>
        </div>
      ) : null}
      {warranty ? (
        <div className={s.bottomItem}>
          <span className={s.description}>{t('inventory.card.warrantyLabel')}</span>
          <span className={s.title}>{warranty}</span>
        </div>
      ) : null}
      <div className={s.bottomItem}>
        <span className={s.description}>{t('inventory.card.priceLabel')}</span>
        <span className={s.title}>{formatPrice(item.price, item.currency, i18n.language)}</span>
      </div>
    </div>
  );
};

export const CardMeta = memo(CardMetaImpl);
