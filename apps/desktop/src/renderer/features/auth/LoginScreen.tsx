import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import logoUrl from '~/assets/logolzt.svg';
import s from './LoginScreen.module.scss';

export const LoginScreen = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'browser' | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.launcher.app.getVersion().then(setVersion);
  }, []);

  const handleBrowser = async () => {
    setBusy('browser');
    try {
      await window.launcher.auth.openBrowser();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className={s.loginContainer}>
        <div className={s.loginBlock}>
          <img className={s.logo} src={logoUrl} alt="Lolzteam" />
          <div className={s.text}>
            <span className={s.title}>
              Lolzteam Launcher
            </span>
            <span className={s.description}>
              Войдите через аккаунт Lolzteam, чтобы получить доступ к купленным аккаунтам и заходить в них одним кликом.
            </span>
          </div>
          <button
            type="button"
            className={s.button}
            onClick={handleBrowser}
            disabled={busy !== null}
          >
            <ExternalLink size={16} />
            <span>
              {busy === 'browser' ? t('login.busyBrowser') : t('login.openBrowser')}
            </span>
          </button>
        </div>

        {version && <span className={s.version}>v{version}</span>}
      </div>
    </>
  );
};
