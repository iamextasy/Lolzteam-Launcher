import type { AccountSummary } from '@shared-types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag } from '~/widgets/Flag/Flag';
import s from '../AccountCard.module.scss';
import { countryName } from '../lib/format';

interface CardAboutProps {
  item: AccountSummary;
}

const CardAboutImpl = ({ item }: CardAboutProps) => {
  const { i18n } = useTranslation();
  const country = item.telegram?.country ?? item.steam?.country ?? null;
  if (!country) return null;

  return (
    <div className={s.aboutBlock}>
      <span className={s.country}>
        <Flag code={country} className={s.flag} /> {countryName(country, i18n.language)}
      </span>
    </div>
  );
};

export const CardAbout = memo(CardAboutImpl);
