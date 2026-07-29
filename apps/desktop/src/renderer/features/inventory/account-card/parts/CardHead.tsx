import type { AccountSummary } from '@shared-types';
import { Tag } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import s from '../AccountCard.module.scss';
import { categoryTextFor, thumbFor } from '../lib/logos';

interface CardHeadProps {
  item: AccountSummary;
  isInvalid: boolean;
}

const CardHeadImpl = ({ item, isInvalid }: CardHeadProps) => {
  const { t } = useTranslation();
  const thumb = thumbFor(item);

  return (
    <header className={s.head}>
      <div className={s.thumbBlock}>
        {thumb ? <img className={s.logo} src={thumb} alt="" /> : <Tag size={20} />}
        <span className={s.category}>{categoryTextFor(item)}</span>
      </div>
      <div className={`${s.status} ${isInvalid ? s.statusInvalid : ''}`}>
        <span className={s.dot} />
        <h3 className={s.text}>
          {isInvalid ? t('inventory.card.statusInvalid') : t('inventory.card.statusValid')}
        </h3>
      </div>
    </header>
  );
};

export const CardHead = memo(CardHeadImpl);
