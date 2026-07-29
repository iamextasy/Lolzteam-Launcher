import { Ban, CheckCircle2, Clock, Star, Tag } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import s from '../AccountCard.module.scss';
import { formatLastSeen, formatShortDate } from '../lib/format';
import type { AccountDetailsProps } from './types';

const TelegramDetailsImpl = ({ item }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const tg = item.telegram;
  if (!tg) return null;

  return (
    <div className={s.steam}>
      <div className={s.badges}>
        {tg.premium ? (
          <span className={`${s.badge} ${s.badgeOk}`}>
            <Star size={12} />
            {t('inventory.card.telegram.premium')}
          </span>
        ) : null}
        {tg.spamBlocked ? (
          <span className={`${s.badge} ${s.badgeDanger}`}>
            <Ban size={12} />
            {t('inventory.card.telegram.spamBlock')}
          </span>
        ) : (
          <span className={`${s.badge} ${s.badgeOk}`}>
            <CheckCircle2 size={12} />
            {t('inventory.card.telegram.noSpamBlock')}
          </span>
        )}
        {tg.origin ? (
          <span className={s.badge}>
            <Tag size={12} />
            {tg.origin}
          </span>
        ) : null}
        {tg.lastSeen ? (
          <span className={s.badge}>
            <Clock size={12} />
            {formatLastSeen(tg.lastSeen, t)}
          </span>
        ) : null}
        {tg.premium && tg.premiumExpires ? (
          <span className={s.badge}>
            {t('inventory.card.telegram.premiumUntil', {
              date: formatShortDate(tg.premiumExpires, i18n.language),
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const TelegramDetails = memo(TelegramDetailsImpl);
