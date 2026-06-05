import type { AuthSession } from '@shared-types';
import { ChevronDown, LogOut, Settings, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import logoUrl from '~/assets/logolzt.svg';
import { useAccountsLoading } from '~/stores/accountsLoading';
import { type StreamService, useAccountsStream } from '~/stores/accountsStream';
import { useLoginSession } from '~/stores/loginSession';
import { useView } from '~/stores/view';
import { ChangelogModal } from '~/widgets/Changelog/ChangelogModal';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './TopBar.module.scss';

interface TopBarProps {
  session: AuthSession | null;
}

const SERVICE_LABELS: Record<StreamService, string> = {
  steam: 'Steam',
  telegram: 'Telegram',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  discord: 'Discord',
};

const formatBalance = (balance: number | null, currency: string | null, locale: string) => {
  if (balance === null) return null;
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const formatted = new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: 2,
  }).format(balance);
  return `${formatted} ${currency ?? ''}`.trim();
};

export const TopBar = ({ session }: TopBarProps) => {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [changelogOpen, setChangelogOpen] = useState(false);
  const setView = useView((st) => st.setView);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.launcher.app.getVersion().then(setVersion);
  }, []);

  const accountsLoading = useAccountsLoading((st) => st.loading);
  const progress = useAccountsStream((st) => st.progress);
  const loggingIn = useLoginSession((st) => st.isOpen && st.step !== 'done' && st.error === null);

  let loadingText: string | null = null;
  if (loggingIn) {
    loadingText = t('topbar.loggingIn');
  } else if (accountsLoading) {
    if (progress) {
      const label = SERVICE_LABELS[progress.service];
      loadingText =
        progress.totalPages && progress.totalPages > 1
          ? t('topbar.loadingCategoryPage', {
              service: label,
              page: progress.page,
              total: progress.totalPages,
              count: progress.count,
            })
          : t('topbar.loadingCategory', { service: label, count: progress.count });
    } else {
      loadingText = t('topbar.loadingAccounts');
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const balance = session ? formatBalance(session.balance, session.currency, i18n.language) : null;

  return (
    <header className={s.topbar}>
      <div className={s.brand}>
        <img className={s.brandLogo} src={logoUrl} aria-hidden alt="Lolzteam" />
        {version && (
          <Tooltip label={t('changelog.title')} placement="bottom">
            <button type="button" className={s.versionPill} onClick={() => setChangelogOpen(true)}>
              v{version}
            </button>
          </Tooltip>
        )}
      </div>

      {loadingText && (
        <div className={s.loadingBar}>
          <svg
            className={s.spin}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 2V6M12 18V22M6 12H2M22 12H18M19.0784 19.0784L16.25 16.25M19.0784 4.99994L16.25 7.82837M4.92157 19.0784L7.75 16.25M4.92157 4.99994L7.75 7.82837"
              stroke="white"
              strokeOpacity="0.72"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {loadingText}
        </div>
      )}

      {session && (
        <div className={s.profile} ref={profileRef}>
          <button
            type="button"
            className={s.profileTrigger}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {session.avatarUrl ? (
              <img className={s.avatar} src={session.avatarUrl} alt="" />
            ) : (
              <div className={s.avatarFallback}>
                <User size={16} />
              </div>
            )}
            <div className={s.profileText}>
              <span className={s.username}>{session.username}</span>
              {balance && <span className={s.balance}>{balance}</span>}
            </div>
            <ChevronDown size={16} className={`${s.chevron} ${menuOpen ? s.chevronOpen : ''}`} />
          </button>

          {menuOpen && (
            <div className={s.menu} role="menu">
              <button
                type="button"
                className={s.menuItem}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setView('settings');
                }}
              >
                <Settings size={16} />
                <span>{t('sidebar.settings')}</span>
              </button>
              <button
                type="button"
                className={s.menuItem}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  window.launcher.auth.logout();
                }}
              >
                <LogOut size={16} />
                <span>{t('topbar.logout')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {changelogOpen && (
        <ChangelogModal currentVersion={version} onClose={() => setChangelogOpen(false)} />
      )}
    </header>
  );
};
