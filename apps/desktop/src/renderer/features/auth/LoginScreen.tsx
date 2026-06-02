import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Languages, Check, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalePreference } from '@shared-types';
import logoUrl from '~/assets/logolzt.svg';
import backgroundUrl from '~/assets/background.svg';
import s from './LoginScreen.module.scss';

const LOCALE_OPTIONS: readonly LocalePreference[] = ['ru', 'en'] as const;

type NetState =
  | { kind: 'checking' }
  | { kind: 'online'; ms: number }
  | { kind: 'offline' };

export const LoginScreen = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'browser' | null>(null);
  const [version, setVersion] = useState('');
  const [locale, setLocale] = useState<LocalePreference>('ru');
  const [langOpen, setLangOpen] = useState(false);
  const [net, setNet] = useState<NetState>({ kind: 'checking' });
  const langRef = useRef<HTMLDivElement>(null);

  const checkNetwork = useCallback(async () => {
    setNet({ kind: 'checking' });
    const res = await window.launcher.app.pingApi();
    setNet(res.online ? { kind: 'online', ms: res.ms } : { kind: 'offline' });
  }, []);

  useEffect(() => {
    window.launcher.app.getVersion().then(setVersion);
    window.launcher.settings.get().then((next) => setLocale(next.settings.locale));
    const off = window.launcher.settings.onChanged((next) => setLocale(next.settings.locale));
    void checkNetwork();
    return off;
  }, [checkNetwork]);

  useEffect(() => {
    if (!langOpen) return;
    const onClick = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [langOpen]);

  const handleBrowser = async () => {
    setBusy('browser');
    try {
      await window.launcher.auth.openBrowser();
    } finally {
      setBusy(null);
    }
  };

  const pickLocale = async (next: LocalePreference) => {
    setLangOpen(false);
    const res = await window.launcher.settings.set({ locale: next });
    setLocale(res.settings.locale);
  };

  return (
    <>
      <div className={s.loginContainer}>
        <div
          className={s.background}
          aria-hidden="true"
          style={{ '--login-bg': `url(${backgroundUrl})` } as React.CSSProperties}
        />

        <div
          className={`${s.netStatus} ${
            net.kind === 'online'
              ? s.netOnline
              : net.kind === 'offline'
                ? s.netOffline
                : s.netChecking
          }`}
          role="status"
        >
          {net.kind === 'checking' && (
            <>
              <Loader2 size={14} className={s.netSpin} />
              <span>{t('login.network.checking')}</span>
            </>
          )}
          {net.kind === 'online' && (
            <>
              <Wifi size={14} />
              <span>{t('login.network.online', { ms: net.ms })}</span>
            </>
          )}
          {net.kind === 'offline' && (
            <>
              <WifiOff size={14} />
              <span>{t('login.network.offline')}</span>
              <button type="button" className={s.netRetry} onClick={checkNetwork}>
                {t('login.network.retry')}
              </button>
            </>
          )}
        </div>

        <div className={s.loginBlock}>
          <img className={s.logo} src={logoUrl} alt="Lolzteam" />
          <div className={s.text}>
            <span className={s.title}>{t('login.title')}</span>
            <span className={s.description}>{t('login.lede')}</span>
          </div>
          <div className={s.actions}>
            <button
              type="button"
              className={s.button}
              onClick={handleBrowser}
              disabled={busy !== null || net.kind !== 'online'}
            >
              <ExternalLink size={16} />
              <span>
                {busy === 'browser' ? t('login.busyBrowser') : t('login.openBrowser')}
              </span>
            </button>
            <div className={s.langWrap} ref={langRef}>
              <button
                type="button"
                className={s.langButton}
                aria-label={t('login.language')}
                aria-haspopup="menu"
                aria-expanded={langOpen}
                onClick={() => setLangOpen((v) => !v)}
              >
                <Languages size={18} />
              </button>
              {langOpen && (
                <div className={s.langMenu} role="menu">
                  {LOCALE_OPTIONS.map((opt) => {
                    const active = locale === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={`${s.langOption} ${active ? s.langOptionActive : ''}`}
                        onClick={() => pickLocale(opt)}
                      >
                        <span>{t(`settings.language.${opt}`)}</span>
                        {active && <Check size={16} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {version && <span className={s.version}>v{version}</span>}
      </div>
    </>
  );
};
