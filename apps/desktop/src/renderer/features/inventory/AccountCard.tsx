import { Fragment, memo, useState, type ReactNode } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  LogIn,
  Loader2,
  ShieldCheck,
  Star,
  Tag,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AccountSummary, ServiceId, SteamInfo, TelegramInfo } from '@shared-types';
import { useLoginSession, type LoginService } from '~/stores/loginSession';
import { Modal } from '~/widgets/Modal/Modal';
import steamLogo from '~/assets/category/steam.svg';
import telegramLogo from '~/assets/category/telegram.svg';
import tiktokLogo from '~/assets/category/tiktok.svg';
import s from './AccountCard.module.scss';

interface AccountCardProps {
  item: AccountSummary;
}

const CATEGORY_LOGOS: Partial<Record<ServiceId, string>> = {
  steam: steamLogo,
  telegram: telegramLogo,
  tiktok: tiktokLogo,
};

const STEAM_ICON_BASE = 'https://nztcdn.com/steam/icon';

const formatHours = (hours: number, locale: string): string => {
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(rounded);
};

const formatLastSeen = (
  unixSeconds: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string => {
  const days = Math.floor((Date.now() - unixSeconds * 1000) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t('inventory.card.steam.lastSeenToday');
  return t('inventory.card.steam.lastSeenDays', { count: days });
};

// "Куплен N дн./ч. назад". Falls back to an absolute date for older purchases.
const formatPurchasedAgo = (
  unixSeconds: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
): string => {
  const ms = Date.now() - unixSeconds * 1000;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 30) {
    const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
    return new Intl.DateTimeFormat(intlLocale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(unixSeconds * 1000);
  }
  if (days >= 1) return t('inventory.card.purchasedDays', { count: days });
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return t('inventory.card.purchasedHours', { count: hours });
  return t('inventory.card.purchasedRecently');
};

// Windows fonts lack regional-indicator flag glyphs, so emoji flags render as
// letter pairs. Use raster flags from flagcdn (whitelisted in the CSP img-src).
const CountryFlag = ({ code }: { code: string }) => {
  if (code.length !== 2) return null;
  const cc = code.toLowerCase();
  return (
    <img
      className={s.flag}
      src={`https://flagcdn.com/h20/${cc}.png`}
      srcSet={`https://flagcdn.com/h40/${cc}.png 2x`}
      width={20}
      height={15}
      alt=""
      loading="lazy"
    />
  );
};

const REGION_NAMES_RU = new Intl.DisplayNames(['ru'], { type: 'region' });
const REGION_NAMES_EN = new Intl.DisplayNames(['en'], { type: 'region' });

const countryName = (code: string, locale: string): string => {
  try {
    const names = locale === 'ru' ? REGION_NAMES_RU : REGION_NAMES_EN;
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

const formatPrice = (value: number, currency: string, locale: string) => {
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
};

// Categories the launcher can actually sign into, mapped to the login pipeline
// they use: native desktop clients (steam/telegram) vs. cookie-injection into a
// built-in browser window (tiktok/instagram/...).
const LOGIN_SERVICE_BY_CATEGORY: Partial<Record<NonNullable<AccountSummary['category']>, LoginService>> = {
  steam: 'steam',
  telegram: 'telegram',
  tiktok: 'browser',
  instagram: 'browser',
};

const toLoginService = (category: AccountSummary['category']): LoginService | null =>
  category ? LOGIN_SERVICE_BY_CATEGORY[category] ?? null : null;

const loginMethodFor = (service: LoginService): 'native' | 'web' =>
  service === 'browser' ? 'web' : 'native';

const SteamDetails = ({ steam }: { steam: SteamInfo }) => {
  const { t, i18n } = useTranslation();
  const isValid = steam.tags.some((tag) => tag.toLowerCase().includes('валид'));
  const banned = steam.vacBanned || steam.communityBanned || steam.tradeBanned;

  return (
    <div className={s.steam}>
      <div className={s.badges}>
        {banned ? (
          <span className={`${s.badge} ${s.badgeDanger}`}>
            <Ban size={12} />
            {t('inventory.card.steam.banned')}
          </span>
        ) : isValid ? (
          <span className={`${s.badge} ${s.badgeOk}`}>
            <CheckCircle2 size={12} />
            {t('inventory.card.steam.valid')}
          </span>
        ) : null}
        {steam.isLimited && (
          <span className={`${s.badge} ${s.badgeWarn}`}>
            <Lock size={12} />
            {t('inventory.card.steam.limited')}
          </span>
        )}
        {steam.hasMfa && (
          <span className={s.badge}>
            <KeyRound size={12} />
            {t('inventory.card.steam.mfa')}
          </span>
        )}
        {steam.origin && (
          <span className={s.badge}>
            <Tag size={12} />
            {steam.origin}
          </span>
        )}
        {typeof steam.gameCount === 'number' && steam.gameCount > 0 && (
          <span className={s.badge}>
            {t('inventory.card.steam.games', { count: steam.gameCount })}
          </span>
        )}
        {steam.lastActivity && (
          <span className={s.badge}>
            <Clock size={12} />
            {formatLastSeen(steam.lastActivity, t)}
          </span>
        )}
      </div>

      {steam.games.length > 0 && (
        <ul className={s.games}>
          {steam.games.map((g) => (
            <li key={g.appId} className={s.game} title={`${g.title} · ${formatHours(g.hours, i18n.language)} ${t('inventory.card.steam.hoursShort')}`}>
              <img
                className={s.gameIcon}
                src={`${STEAM_ICON_BASE}/${g.parentGameId}.webp`}
                alt=""
                loading="lazy"
              />
              <span className={s.gameHours}>
                {formatHours(g.hours, i18n.language)} {t('inventory.card.steam.hoursShort')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const TelegramDetails = ({ tg }: { tg: TelegramInfo }) => {
  const { t, i18n } = useTranslation();
  const isValid = tg.tags.some((tag) => tag.toLowerCase().includes('валид'));

  return (
    <div className={s.steam}>
      <div className={s.badges}>
        {isValid && (
          <span className={`${s.badge} ${s.badgeOk}`}>
            <CheckCircle2 size={12} />
            {t('inventory.card.steam.valid')}
          </span>
        )}
        {tg.premium && (
          <span className={`${s.badge} ${s.badgeOk}`}>
            <Star size={12} />
            {t('inventory.card.telegram.premium')}
          </span>
        )}
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
        {tg.origin && (
          <span className={s.badge}>
            <Tag size={12} />
            {tg.origin}
          </span>
        )}
        {tg.lastSeen && (
          <span className={s.badge}>
            <Clock size={12} />
            {formatLastSeen(tg.lastSeen, t)}
          </span>
        )}
        {tg.premium && tg.premiumExpires && (
          <span className={s.badge}>
            {t('inventory.card.telegram.premiumUntil', {
              date: new Intl.DateTimeFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
                day: 'numeric',
                month: 'short',
              }).format(tg.premiumExpires * 1000),
            })}
          </span>
        )}
      </div>
    </div>
  );
};

const AccountCardImpl = ({ item }: AccountCardProps) => {
  const { t, i18n } = useTranslation();

  const formatWarranty = (warrantyEndsAt: number | null): string | null => {
    if (!warrantyEndsAt) return null;
    const ms = warrantyEndsAt * 1000 - Date.now();
    if (ms <= 0) return null;
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days >= 1) return t('inventory.card.warrantyDays', { count: days });
    const hours = Math.ceil(ms / (60 * 60 * 1000));
    return t('inventory.card.warrantyHours', { count: hours });
  };

  const warranty = formatWarranty(item.warrantyEndsAt);
  const service = toLoginService(item.category);
  const canLogin = service !== null;
  const categoryLogo = item.category ? CATEGORY_LOGOS[item.category] : undefined;

  const tg = item.telegram;
  const country = tg?.country ?? item.steam?.country ?? null;
  const aboutParts: ReactNode[] = [];
  if (country) {
    aboutParts.push(
      <span key="country" className={s.country}>
        <CountryFlag code={country} /> {countryName(country, i18n.language)}
      </span>,
    );
  }

  const purchased = item.purchasedAt
    ? formatPurchasedAgo(item.purchasedAt, t, i18n.language)
    : null;
  const activeItemId = useLoginSession((s) => s.itemId);
  const step = useLoginSession((s) => s.step);
  const error = useLoginSession((s) => s.error);
  // Only spin while this card's login is actually running. Once it resolves
  // (step 'done' or an error) the modal stays open showing the result, but the
  // button must return to its idle state.
  const inProgress = step !== null && step !== 'done' && error === null;
  const busy = inProgress && activeItemId === item.itemId;

  const [warnOpen, setWarnOpen] = useState(false);

  const runLogin = async () => {
    if (!service) return;
    const sess = useLoginSession.getState();
    sess.start(item.itemId, item.title, service);
    try {
      const res = await window.launcher.accounts.login(
        item.itemId,
        loginMethodFor(service),
      );
      if (!res.ok) sess.fail(res.message ?? t('inventory.card.loginFailedFallback'));
    } catch (err) {
      sess.fail(err instanceof Error ? err.message : t('inventory.card.callError'));
    }
  };

  const handleLogin = () => {
    if (!service) return;
    // Steam sign-in may need to fetch the mafile (for a Steam Guard code), which
    // cancels the account's active warranty. Warn first when a warranty is live.
    if (service === 'steam' && warranty) {
      setWarnOpen(true);
      return;
    }
    void runLogin();
  };

  return (
    <article className={s.card}>
      <div className={s.topSection}>
        <header className={s.head}>
          <div className={s.thumbBlock}>
              {item.imageUrl ? (
                <img className={s.logo} src={item.imageUrl} alt="" />
              ) : categoryLogo ? (
                <img className={s.logo} src={categoryLogo} alt="" />
              ) : (
                <Tag size={20} />
              )}
            <span className={s.category}>{item.categoryTitle}</span>
          </div>
          <div className={s.status}>
            <span className={s.dot}></span>
            <h3 className={s.text}>Активен</h3>
          </div>
        </header>

        <h3 className={s.titleAccount}>{item.title}</h3>

        {aboutParts.length > 0 && (
          <div className={s.aboutBlock}>
            {aboutParts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className={s.dot}></span>}
                {part}
              </Fragment>
            ))}
          </div>
        )}

        {item.steam && <SteamDetails steam={item.steam} />}
        {item.telegram && <TelegramDetails tg={item.telegram} />}


      </div>


      <div className={s.bottomBlock}>
        <span className={s.divider}></span>

        <div className={s.bottomGroup}>
        {purchased && (
          <div className={s.bottomItem}>
              <span className={s.description}>
                {t('inventory.card.purchasedLabel')}
              </span>
            <span className={s.title}>{purchased}</span>
          </div>
        )}
        {warranty && (
          <div className={s.bottomItem}>
              <span className={s.description}>
                {t('inventory.card.warrantyLabel')}
              </span>
            <span className={s.title}>{warranty}</span>
          </div>
        )}
        <div className={s.bottomItem}>
            <span className={s.description}>
              {t('inventory.card.priceLabel')}
            </span>
          <span className={s.title}>
              {formatPrice(item.price, item.currency, i18n.language)}
            </span>
        </div>
      </div>

      <button
        type="button"
        className={s.login}
        disabled={!canLogin || busy}
        onClick={handleLogin}
        title={
          canLogin
            ? t('inventory.card.loginTooltip')
            : t('inventory.card.unsupportedTooltip')
        }
      >
        {busy ? <Loader2 size={16} className={s.spin} /> : <LogIn size={16} />}
        <span>{busy ? t('inventory.card.busy') : t('inventory.card.login')}</span>
      </button>
      </div>

      {warnOpen && (
        <Modal title={t('inventory.card.warrantyWarnTitle')} onClose={() => setWarnOpen(false)}>
          <p className={s.warnBody}>
            {t('inventory.card.warrantyWarnBody', { warranty })}
          </p>
          <div className={s.warnActions}>
            <button
              type="button"
              className={s.warnCancel}
              onClick={() => setWarnOpen(false)}
            >
              {t('inventory.card.warrantyWarnCancel')}
            </button>
            <button
              type="button"
              className={s.warnConfirm}
              onClick={() => {
                setWarnOpen(false);
                void runLogin();
              }}
            >
              {t('inventory.card.warrantyWarnConfirm')}
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
};

export const AccountCard = memo(AccountCardImpl);
