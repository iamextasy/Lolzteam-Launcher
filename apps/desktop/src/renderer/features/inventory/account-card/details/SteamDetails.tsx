import { Ban, CheckCircle2, Clock, KeyRound, Lock, Tag } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from '../AccountCard.module.scss';
import { formatHours, formatLastSeen } from '../lib/format';
import type { AccountDetailsProps } from './types';

const STEAM_ICON_BASE = 'https://nztcdn.com/steam/icon';

const SteamDetailsImpl = ({ item }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const steam = item.steam;
  if (!steam) return null;

  const banned = steam.vacBanned || steam.communityBanned || steam.tradeBanned;

  return (
    <div className={s.steam}>
      <div className={s.badges}>
        {banned ? (
          <>
            {steam.vacBanned ? (
              <span className={`${s.badge} ${s.badgeDanger}`}>
                <Ban size={12} />
                {t('inventory.card.steam.banVac')}
              </span>
            ) : null}
            {steam.communityBanned ? (
              <span className={`${s.badge} ${s.badgeDanger}`}>
                <Ban size={12} />
                {t('inventory.card.steam.banCommunity')}
              </span>
            ) : null}
            {steam.tradeBanned ? (
              <span className={`${s.badge} ${s.badgeDanger}`}>
                <Ban size={12} />
                {t('inventory.card.steam.banTrade')}
              </span>
            ) : null}
          </>
        ) : (
          <span className={`${s.badge} ${s.badgeOk}`}>
            <CheckCircle2 size={12} />
            {t('inventory.card.steam.noBan')}
          </span>
        )}
        {steam.isLimited ? (
          <span className={`${s.badge} ${s.badgeWarn}`}>
            <Lock size={12} />
            {t('inventory.card.steam.limited')}
          </span>
        ) : null}
        {steam.hasMfa ? (
          <span className={s.badge}>
            <KeyRound size={12} />
            {t('inventory.card.steam.mfa')}
          </span>
        ) : null}
        {steam.origin ? (
          <span className={s.badge}>
            <Tag size={12} />
            {steam.origin}
          </span>
        ) : null}
        {typeof steam.gameCount === 'number' && steam.gameCount > 0 ? (
          <span className={s.badge}>
            {t('inventory.card.steam.games', { count: steam.gameCount })}
          </span>
        ) : null}
        {steam.lastActivity ? (
          <span className={s.badge}>
            <Clock size={12} />
            {formatLastSeen(steam.lastActivity, t)}
          </span>
        ) : null}
      </div>

      {steam.games.length > 0 ? (
        <ul className={s.games}>
          {steam.games.map((g) => {
            const hours = `${formatHours(g.hours, i18n.language)} ${t('inventory.card.steam.hoursShort')}`;
            return (
              <Tooltip key={g.appId} label={`${g.title} · ${hours}`}>
                <li className={s.game}>
                  <img
                    className={s.gameIcon}
                    src={`${STEAM_ICON_BASE}/${g.parentGameId}.webp`}
                    alt=""
                    loading="lazy"
                  />
                  <span className={s.gameHours}>{hours}</span>
                </li>
              </Tooltip>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export const SteamDetails = memo(SteamDetailsImpl);
