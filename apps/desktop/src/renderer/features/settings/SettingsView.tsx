import type { LauncherSettings, LocalePreference, MarketCurrency } from '@shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencyModal } from '~/features/profile/CurrencyModal';
import { LanguageModal } from '~/features/profile/LanguageModal';
import { CURRENCY_FLAG, LOCALE_FLAG } from '~/lib/flags';
import { useSettings } from '~/stores/settings';
import { useUpdater } from '~/stores/updater';
import { Flag } from '~/widgets/Flag/Flag';
import { Modal } from '~/widgets/Modal/Modal';
import { LoginMethodsView } from './LoginMethodsView';
import { ProfileView } from './ProfileView';
import { ProxyView } from './ProxyView';
import s from './SettingsView.module.scss';

const TG_ACCOUNT_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 0, label: '∞' },
];

const CONCURRENCY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

const BG_REFRESH_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: '✕' },
  { value: 15, label: '15м' },
  { value: 30, label: '30м' },
  { value: 60, label: '60м' },
];

export const SettingsView = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<LauncherSettings | null>(
    () => useSettings.getState().settings,
  );
  const [picking, setPicking] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [exportingLog, setExportingLog] = useState(false);
  const [logExported, setLogExported] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [steamConfirmOpen, setSteamConfirmOpen] = useState(false);
  const [clearingSteam, setClearingSteam] = useState(false);
  const [steamCleared, setSteamCleared] = useState(false);
  const [steamClearError, setSteamClearError] = useState(false);
  const updateStatus = useUpdater((u) => u.status);
  const setUpdateStatus = useUpdater((u) => u.setStatus);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [showProxy, setShowProxy] = useState(false);
  const [showLoginMethods, setShowLoginMethods] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const authStatus = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => window.launcher.auth.getStatus(),
  });
  const curCode = authStatus.data?.session?.currency?.toLowerCase();
  const currencyFlag =
    curCode && curCode in CURRENCY_FLAG ? CURRENCY_FLAG[curCode as MarketCurrency] : undefined;

  useEffect(() => {
    let alive = true;
    window.launcher.settings.get().then((next) => {
      if (alive) setSettings(next.settings);
    });
    const off = window.launcher.settings.onChanged((next) => setSettings(next.settings));
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => window.launcher.updater.onStatus(setUpdateStatus), [setUpdateStatus]);

  useEffect(() => {
    let alive = true;
    window.launcher.app.getVersion().then((v) => {
      if (alive) setAppVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const pickTelegramExe = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const path = await window.launcher.settings.pickFile({
        title: t('settings.telegram.pickDialogTitle'),
        filters: [{ name: t('settings.telegram.pickFilterName'), extensions: ['exe'] }],
      });
      if (path) {
        const next = await window.launcher.settings.set({ telegramExePath: path });
        setSettings(next.settings);
      }
    } finally {
      setPicking(false);
    }
  };

  const clearTelegramExe = async () => {
    const next = await window.launcher.settings.set({ telegramExePath: null });
    setSettings(next.settings);
  };

  const setTelegramMaxAccounts = async (n: number) => {
    const next = await window.launcher.settings.set({ telegramMaxAccounts: n });
    setSettings(next.settings);
  };

  const toggleSteamInvisible = async () => {
    const next = await window.launcher.settings.set({
      steamInvisible: !(settings?.steamInvisible ?? false),
    });
    setSettings(next.settings);
  };

  const toggleSteamAutoLaunch = async () => {
    const next = await window.launcher.settings.set({
      steamAutoLaunchGame: !(settings?.steamAutoLaunchGame ?? false),
    });
    setSettings(next.settings);
  };

  const setSteamAutoLaunchAppId = async (raw: string) => {
    const appId = raw.replace(/\D/g, '').slice(0, 8);
    const next = await window.launcher.settings.set({ steamAutoLaunchAppId: appId });
    setSettings(next.settings);
  };

  const toggleRefreshOnLaunch = async () => {
    const next = await window.launcher.settings.set({
      refreshOnLaunch: !(settings?.refreshOnLaunch ?? true),
    });
    setSettings(next.settings);
  };

  const toggleMinimizeToTray = async () => {
    const next = await window.launcher.settings.set({
      minimizeToTray: !(settings?.minimizeToTray ?? true),
    });
    setSettings(next.settings);
  };

  const setBackgroundRefreshMinutes = async (n: number) => {
    const next = await window.launcher.settings.set({ backgroundRefreshMinutes: n });
    setSettings(next.settings);
  };

  const setAccountLoadConcurrency = async (n: number) => {
    const next = await window.launcher.settings.set({ accountLoadConcurrency: n });
    setSettings(next.settings);
  };

  const clearCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheCleared(false);
    try {
      await window.launcher.accounts.clearCache();
      // Drop the cached list so the next visit to "My accounts" refetches fresh.
      await qc.invalidateQueries({ queryKey: ['accounts'] });
      setCacheCleared(true);
    } finally {
      setClearingCache(false);
    }
  };

  const exportLog = async () => {
    if (exportingLog) return;
    setExportingLog(true);
    setLogExported(false);
    try {
      const result = await window.launcher.app.exportLog();
      if (result.ok) setLogExported(true);
    } finally {
      setExportingLog(false);
    }
  };

  const clearSteamSession = async () => {
    if (clearingSteam) return;
    setSteamConfirmOpen(false);
    setClearingSteam(true);
    setSteamCleared(false);
    setSteamClearError(false);
    try {
      const result = await window.launcher.steam.clearSession();
      if (result.ok) setSteamCleared(true);
      else setSteamClearError(true);
    } catch {
      setSteamClearError(true);
    } finally {
      setClearingSteam(false);
    }
  };

  const checkForUpdates = () => {
    if (updateStatus?.state === 'checking') return;
    void window.launcher.updater.check();
  };

  const openExternal = (url: string) => () => void window.launcher.app.openExternal(url);

  const tgPath = settings?.telegramExePath ?? null;
  const telegramMaxAccounts = settings?.telegramMaxAccounts ?? 3;
  const currentLocale: LocalePreference = settings?.locale ?? 'ru';
  const steamInvisible = settings?.steamInvisible ?? false;
  const steamAutoLaunch = settings?.steamAutoLaunchGame ?? false;
  const steamAutoLaunchAppId = settings?.steamAutoLaunchAppId ?? '';

  const cacheDescription = clearingCache
    ? t('settings.cache.clearing')
    : cacheCleared
      ? t('settings.cache.cleared')
      : t('settings.cache.menuHint');

  const logsDescription = exportingLog
    ? t('settings.logs.exporting')
    : logExported
      ? t('settings.logs.exported')
      : t('settings.logs.menuHint');

  const steamClearDescription = clearingSteam
    ? t('settings.steam.clearing')
    : steamCleared
      ? t('settings.steam.cleared')
      : steamClearError
        ? t('settings.steam.clearError')
        : t('settings.steam.clearHint');

  const checkingUpdate = updateStatus?.state === 'checking';
  const updateIsGood = updateStatus?.state === 'available' || updateStatus?.state === 'downloaded';
  const updateDescription = (() => {
    switch (updateStatus?.state) {
      case 'checking':
        return t('settings.update.checking');
      case 'available':
        return t('settings.update.available', { version: updateStatus.version });
      case 'not-available':
        return t('settings.update.notAvailable', { version: appVersion ?? '' });
      case 'downloading':
        return t('settings.update.downloading');
      case 'downloaded':
        return t('settings.update.downloaded', { version: updateStatus.version });
      case 'error':
        return t('settings.update.error');
      default:
        return t('settings.update.menuHint', { version: appVersion ?? '' });
    }
  })();

  if (showProxy) return <ProxyView onBack={() => setShowProxy(false)} />;
  if (showLoginMethods) return <LoginMethodsView onBack={() => setShowLoginMethods(false)} />;
  if (showProfile) return <ProfileView onBack={() => setShowProfile(false)} />;

  return (
    <>
      <div className={s.settingsContainer}>
        <div className={s.settingsBlock}>
          <div className={s.settingsItem}>
            <span className={s.prefix}>Telegram</span>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={pickTelegramExe}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void pickTelegramExe();
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.telegram.sessionFolder')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>
                    {tgPath ?? t('settings.telegram.placeholderNoFile')}
                  </span>
                  {tgPath && (
                    <span
                      className={s.greenText}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void clearTelegramExe();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          void clearTelegramExe();
                        }
                      }}
                    >
                      {t('settings.telegram.clear')}
                    </span>
                  )}
                </div>
                <span className={s.alert}>{t('settings.telegram.alert')}</span>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M1.9974 4.16783C1.9974 3.79417 2.40191 3.33333 2.95785 3.33333H5.33073C5.73748 3.33333 6.16935 3.48564 6.42771 3.73436C6.43317 3.73966 6.43877 3.74486 6.44446 3.74997L7.46144 4.66373C7.5838 4.77369 7.74251 4.83449 7.907 4.83449H11.7036C12.1528 4.83449 12.6027 5.14209 12.6724 5.5784C12.7305 5.94196 13.0724 6.1896 13.4359 6.13151C13.7995 6.07342 14.0471 5.73156 13.989 5.368C13.7876 4.10732 12.6104 3.50116 11.7036 3.50116H8.16251L7.34344 2.76523C6.78873 2.23674 6.00508 2 5.33073 2H2.95785C1.75108 2 0.664062 2.97506 0.664062 4.16783V12C0.664062 12.0286 0.665858 12.0567 0.669347 12.0844C0.594049 13.0485 1.35757 14 2.4 14H11.5958C12.7362 14 13.777 13.2931 14.2114 12.2367L15.2134 9.73289L15.2145 9.73004C15.6487 8.63022 14.8118 7.33333 13.5948 7.33333H4.39908C3.689 7.33333 3.07906 7.6048 2.58244 8.01996C2.3466 8.20182 2.15198 8.4204 1.9974 8.67V4.16783ZM3.4298 9.04947C3.73051 8.7956 4.04909 8.66667 4.39908 8.66667H13.5948C13.7042 8.66667 13.8267 8.72742 13.915 8.85964C14.0038 8.99262 14.0155 9.13511 13.9746 9.23951L13.9743 9.2404L12.9771 11.7323C12.7446 12.2947 12.1868 12.6667 11.5958 12.6667H2.4C2.2906 12.6667 2.16812 12.6059 2.07984 12.4737C1.99108 12.3408 1.97938 12.1983 2.02015 12.094L3.01896 9.59787L3.02009 9.59502C3.11251 9.36093 3.24167 9.19356 3.40307 9.07089C3.41216 9.064 3.42107 9.05684 3.4298 9.04947Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={openExternal('https://github.com/telegramdesktop/tdesktop/releases/latest')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openExternal('https://github.com/telegramdesktop/tdesktop/releases/latest')();
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.telegram.releaseLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.telegram.releaseHint')}</span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M13 3C13 2.44772 12.5523 2 12 2C11.4477 2 11 2.44772 11 3V12.5858L7.70711 9.29289C7.31658 8.90237 6.68342 8.90237 6.29289 9.29289C5.90237 9.68342 5.90237 10.3166 6.29289 10.7071L11.2929 15.7071C11.6834 16.0976 12.3166 16.0976 12.7071 15.7071L17.7071 10.7071C18.0976 10.3166 18.0976 9.68342 17.7071 9.29289C17.3166 8.90237 16.6834 8.90237 16.2929 9.29289L13 12.5858V3Z"
                  fill="currentColor"
                />
                <path
                  d="M3 14C3.55229 14 4 14.4477 4 15V16.2C4 17.0566 4.00078 17.6389 4.03755 18.089C4.07337 18.5274 4.1383 18.7516 4.21799 18.908C4.40973 19.2843 4.7157 19.5903 5.09202 19.782C5.24842 19.8617 5.47262 19.9266 5.91104 19.9624C6.36113 19.9992 6.94342 20 7.8 20H16.2C17.0566 20 17.6389 19.9992 18.089 19.9624C18.5274 19.9266 18.7516 19.8617 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.782 18.908C19.8617 18.7516 19.9266 18.5274 19.9624 18.089C19.9992 17.6389 20 17.0566 20 16.2V15C20 14.4477 20.4477 14 21 14C21.5523 14 22 14.4477 22 15V16.2413C22 17.0463 22 17.7106 21.9558 18.2518C21.9099 18.8139 21.8113 19.3306 21.564 19.816C21.1805 20.5686 20.5686 21.1805 19.816 21.564C19.3306 21.8113 18.8139 21.9099 18.2518 21.9558C17.7106 22 17.0463 22 16.2413 22H7.7587C6.95373 22 6.28937 22 5.74818 21.9558C5.18608 21.9099 4.66937 21.8113 4.18404 21.564C3.43139 21.1805 2.81947 20.5686 2.43598 19.816C2.18868 19.3306 2.09012 18.8139 2.04419 18.2518C1.99998 17.7106 1.99999 17.0463 2 16.2413V15C2 14.4477 2.44772 14 3 14Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.telegram.accountsLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.telegram.accountsHint')}</span>
                </div>
              </div>
              <div className={s.segmented}>
                {TG_ACCOUNT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${s.segmentBtn} ${
                      telegramMaxAccounts === opt.value ? s.segmentBtnActive : ''
                    }`}
                    onClick={() => void setTelegramMaxAccounts(opt.value)}
                    title={
                      opt.value === 0 ? t('settings.telegram.accountsUnlimited') : String(opt.value)
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={s.settingsItem}>
            <span className={s.prefix}>Steam</span>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.steam.invisibleLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.steam.invisibleHint')}</span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={steamInvisible}
                className={s.toggleRow}
                onClick={toggleSteamInvisible}
              >
                <span className={`${s.switch} ${steamInvisible ? s.switchOn : ''}`}>
                  <span className={s.switchKnob} />
                </span>
              </button>
            </div>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.steam.autoLaunchLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.steam.autoLaunchHint')}</span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={steamAutoLaunch}
                className={s.toggleRow}
                onClick={toggleSteamAutoLaunch}
              >
                <span className={`${s.switch} ${steamAutoLaunch ? s.switchOn : ''}`}>
                  <span className={s.switchKnob} />
                </span>
              </button>
            </div>
            {steamAutoLaunch && (
              <div className={s.settingsMenu}>
                <div className={s.text}>
                  <span className={s.title}>{t('settings.steam.autoLaunchAppIdLabel')}</span>
                  <div className={s.descriptionBlock}>
                    <span className={s.description}>{t('settings.steam.autoLaunchAppIdHint')}</span>
                  </div>
                </div>
                <input
                  className={s.appIdInput}
                  value={steamAutoLaunchAppId}
                  onChange={(e) => void setSteamAutoLaunchAppId(e.target.value)}
                  inputMode="numeric"
                  spellCheck={false}
                  placeholder={t('settings.steam.autoLaunchAppIdPlaceholder')}
                />
              </div>
            )}
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              aria-disabled={clearingSteam}
              onClick={() => !clearingSteam && setSteamConfirmOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!clearingSteam) setSteamConfirmOpen(true);
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.steam.clearLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span
                    className={
                      steamCleared && !clearingSteam
                        ? s.greenText
                        : steamClearError && !clearingSteam
                          ? s.alert
                          : s.description
                    }
                  >
                    {steamClearDescription}
                  </span>
                </div>
              </div>
              {clearingSteam ? (
                <svg
                  className={s.spin}
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M12 2V6M12 18V22M6 12H2M22 12H18M19.0784 19.0784L16.25 16.25M19.0784 4.99994L16.25 7.82837M4.92157 19.0784L7.75 16.25M4.92157 4.99994L7.75 7.82837"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M9 3H15M3 6H21M19 6L18.2987 16.5193C18.1935 18.0975 18.1409 18.8867 17.8 19.485C17.4999 20.0118 17.0472 20.4353 16.5017 20.6997C15.882 21 15.0911 21 13.5093 21H10.4907C8.90891 21 8.11803 21 7.49834 20.6997C6.95276 20.4353 6.50009 20.0118 6.19998 19.485C5.85911 18.8867 5.8065 18.0975 5.70129 16.5193L5 6M10 10.5V15.5M14 10.5V15.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          </div>
          <div className={s.settingsItem}>
            <span className={s.prefix}>{t('settings.profile.title')}</span>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={() => setShowProfile(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowProfile(true);
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.profile.labelsMenu')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.profile.labelsMenuHint')}</span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12H19M19 12L12 5M19 12L12 19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={() => setCurrencyOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCurrencyOpen(true);
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.currency.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.langValue}>
                    {currencyFlag && <Flag code={currencyFlag} className={s.menuFlag} />}
                    <span className={s.description}>
                      {curCode ? curCode.toUpperCase() : t('settings.currency.menuHint')}
                    </span>
                  </span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12H19M19 12L12 5M19 12L12 19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <div className={s.settingsItem}>
            <span className={s.prefix}>{t('settings.app.title')}</span>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={() => setLangOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setLangOpen(true);
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.language.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.langValue}>
                    {LOCALE_FLAG[currentLocale] && (
                      <Flag code={LOCALE_FLAG[currentLocale]} className={s.menuFlag} />
                    )}
                    <span className={s.description}>{t(`settings.language.${currentLocale}`)}</span>
                  </span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M2 12H22M2 12C2 17.5228 6.47715 22 12 22M2 12C2 6.47715 6.47715 2 12 2M22 12C22 17.5228 17.5228 22 12 22M22 12C22 6.47715 17.5228 2 12 2M12 2C14.5013 4.73835 15.9228 8.29203 16 12C15.9228 15.708 14.5013 19.2616 12 22M12 2C9.49872 4.73835 8.07725 8.29203 8 12C8.07725 15.708 9.49872 19.2616 12 22"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.app.refreshOnLaunchLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.app.refreshOnLaunchHint')}</span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings?.refreshOnLaunch ?? true}
                className={s.toggleRow}
                onClick={() => void toggleRefreshOnLaunch()}
              >
                <span
                  className={`${s.switch} ${(settings?.refreshOnLaunch ?? true) ? s.switchOn : ''}`}
                >
                  <span className={s.switchKnob} />
                </span>
              </button>
            </div>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.app.backgroundRefreshLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.app.backgroundRefreshHint')}</span>
                </div>
              </div>
              <div className={s.segmented}>
                {BG_REFRESH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${s.segmentBtn} ${
                      (settings?.backgroundRefreshMinutes ?? 0) === opt.value
                        ? s.segmentBtnActive
                        : ''
                    }`}
                    onClick={() => void setBackgroundRefreshMinutes(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.app.concurrencyLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.app.concurrencyHint')}</span>
                </div>
              </div>
              <div className={s.segmented}>
                {CONCURRENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${s.segmentBtn} ${
                      (settings?.accountLoadConcurrency ?? 2) === opt.value
                        ? s.segmentBtnActive
                        : ''
                    }`}
                    onClick={() => void setAccountLoadConcurrency(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.settingsMenu}>
              <div className={s.text}>
                <span className={s.title}>{t('settings.app.minimizeToTrayLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.app.minimizeToTrayHint')}</span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings?.minimizeToTray ?? true}
                className={s.toggleRow}
                onClick={() => void toggleMinimizeToTray()}
              >
                <span
                  className={`${s.switch} ${(settings?.minimizeToTray ?? true) ? s.switchOn : ''}`}
                >
                  <span className={s.switchKnob} />
                </span>
              </button>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={() => setShowProxy(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowProxy(true);
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.proxy.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.proxy.menuHint')}</span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12H19M19 12L12 5M19 12L12 19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              onClick={() => setShowLoginMethods(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowLoginMethods(true);
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.loginMethods.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={s.description}>{t('settings.loginMethods.menuHint')}</span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12H19M19 12L12 5M19 12L12 19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              aria-disabled={clearingCache}
              onClick={clearCache}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void clearCache();
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.cache.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={cacheCleared && !clearingCache ? s.greenText : s.description}>
                    {cacheDescription}
                  </span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M9 3H15M3 6H21M19 6L18.2987 16.5193C18.1935 18.0975 18.1409 18.8867 17.8 19.485C17.4999 20.0118 17.0472 20.4353 16.5017 20.6997C15.882 21 15.0911 21 13.5093 21H10.4907C8.90891 21 8.11803 21 7.49834 20.6997C6.95276 20.4353 6.50009 20.0118 6.19998 19.485C5.85911 18.8867 5.8065 18.0975 5.70129 16.5193L5 6M10 10.5V15.5M14 10.5V15.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              aria-disabled={exportingLog}
              onClick={exportLog}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void exportLog();
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.logs.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={logExported && !exportingLog ? s.greenText : s.description}>
                    {logsDescription}
                  </span>
                </div>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M14 2.26953V6.40007C14 6.96012 14 7.24015 14.109 7.45406C14.2049 7.64222 14.3578 7.7952 14.546 7.89108C14.7599 8.00007 15.0399 8.00007 15.6 8.00007H19.7305M16 13H8M16 17H8M10 9H8M14 2H8.8C7.11984 2 6.27976 2 5.63803 2.32698C5.07354 2.6146 4.6146 3.07354 4.32698 3.63803C4 4.27976 4 5.11984 4 6.8V17.2C4 18.8802 4 19.7202 4.32698 20.362C4.6146 20.9265 5.07354 21.3854 5.63803 21.673C6.27976 22 7.11984 22 8.8 22H15.2C16.8802 22 17.7202 22 18.362 21.673C18.9265 21.3854 19.3854 20.9265 19.673 20.362C20 19.7202 20 18.8802 20 17.2V8L14 2Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div
              className={s.settingsMenu}
              role="button"
              tabIndex={0}
              aria-disabled={checkingUpdate}
              onClick={checkForUpdates}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void checkForUpdates();
                }
              }}
            >
              <div className={s.text}>
                <span className={s.title}>{t('settings.update.menuLabel')}</span>
                <div className={s.descriptionBlock}>
                  <span className={updateIsGood ? s.greenText : s.description}>
                    {updateDescription}
                  </span>
                </div>
              </div>
              {checkingUpdate ? (
                <svg
                  className={s.spin}
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M12 2V6M12 18V22M6 12H2M22 12H18M19.0784 19.0784L16.25 16.25M19.0784 4.99994L16.25 7.82837M4.92157 19.0784L7.75 16.25M4.92157 4.99994L7.75 7.82837"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M13 3C13 2.44772 12.5523 2 12 2C11.4477 2 11 2.44772 11 3V12.5858L7.70711 9.29289C7.31658 8.90237 6.68342 8.90237 6.29289 9.29289C5.90237 9.68342 5.90237 10.3166 6.29289 10.7071L11.2929 15.7071C11.6834 16.0976 12.3166 16.0976 12.7071 15.7071L17.7071 10.7071C18.0976 10.3166 18.0976 9.68342 17.7071 9.29289C17.3166 8.90237 16.6834 8.90237 16.2929 9.29289L13 12.5858V3Z"
                    fill="currentColor"
                  />
                  <path
                    d="M3 14C3.55229 14 4 14.4477 4 15V16.2C4 17.0566 4.00078 17.6389 4.03755 18.089C4.07337 18.5274 4.1383 18.7516 4.21799 18.908C4.40973 19.2843 4.7157 19.5903 5.09202 19.782C5.24842 19.8617 5.47262 19.9266 5.91104 19.9624C6.36113 19.9992 6.94342 20 7.8 20H16.2C17.0566 20 17.6389 19.9992 18.089 19.9624C18.5274 19.9266 18.7516 19.8617 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.782 18.908C19.8617 18.7516 19.9266 18.5274 19.9624 18.089C19.9992 17.6389 20 17.0566 20 16.2V15C20 14.4477 20.4477 14 21 14C21.5523 14 22 14.4477 22 15V16.2413C22 17.0463 22 17.7106 21.9558 18.2518C21.9099 18.8139 21.8113 19.3306 21.564 19.816C21.1805 20.5686 20.5686 21.1805 19.816 21.564C19.3306 21.8113 18.8139 21.9099 18.2518 21.9558C17.7106 22 17.0463 22 16.2413 22H7.7587C6.95373 22 6.28937 22 5.74818 21.9558C5.18608 21.9099 4.66937 21.8113 4.18404 21.564C3.43139 21.1805 2.81947 20.5686 2.43598 19.816C2.18868 19.3306 2.09012 18.8139 2.04419 18.2518C1.99998 17.7106 1.99999 17.0463 2 16.2413V15C2 14.4477 2.44772 14 3 14Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </div>
          </div>
          <div className={s.socialBlock}>
            <a
              className={s.socialItem}
              role="button"
              tabIndex={0}
              onClick={openExternal('https://github.com/iamextasy/Lolzteam-Launcher')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="98"
                height="96"
                viewBox="0 0 98 96"
                fill="none"
              >
                <g clipPath="url(#clip0_3595_466)">
                  <mask
                    id="mask0_3595_466"
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width="98"
                    height="96"
                  >
                    <path d="M98 0H0V96H98V0Z" fill="white" />
                  </mask>
                  <g mask="url(#mask0_3595_466)">
                    <path
                      d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252V91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 2.38639e-07 48.9043 0C21.8203 -2.38639e-07 2.3864e-07 22.1074 0 49.1914C-1.87201e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008V83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"
                      fill="white"
                    />
                  </g>
                </g>
                <defs>
                  <clipPath id="clip0_3595_466">
                    <rect width="98" height="96" fill="white" />
                  </clipPath>
                </defs>
              </svg>
              GitHub
            </a>
            <a
              className={s.socialItem}
              role="button"
              tabIndex={0}
              onClick={openExternal('https://lolz.live/threads/10024162/')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="256"
                height="256"
                viewBox="0 0 256 256"
                fill="none"
              >
                <g clipPath="url(#clip0_123_378)">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M70.1504 207.392C91.8146 224.992 116.842 235.022 143.533 235.022C183.225 235.022 219.257 212.775 245.995 176.542C234.706 161.247 221.764 148.436 207.575 138.751L184.794 150.124C189.69 157.741 192.542 166.809 192.542 176.542C192.542 203.577 170.604 225.491 143.533 225.491C122.499 225.491 104.566 212.252 97.6139 193.666L70.1504 207.38V207.392ZM126.67 179.168C127.216 182.721 128.88 186.025 131.459 188.604C134.656 191.8 139.005 193.595 143.533 193.583C152.957 193.583 160.598 185.953 160.598 176.542C160.598 171.919 158.756 167.724 155.761 164.646L126.682 179.168H126.67Z"
                    fill="#2BAD72"
                  />
                  <path
                    d="M76.3528 176.16L242.405 96.3367L205.91 20.4229L187.062 87.507L164.412 40.3758L145.552 107.46L122.902 60.3287L104.042 127.413L81.3916 80.2816L62.5319 147.366L39.8814 100.235L9.4707 208.318L50.9809 188.365L76.3528 176.172V176.16Z"
                    fill="#2BAD72"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_123_378">
                    <rect
                      width="236.512"
                      height="214.598"
                      fill="white"
                      transform="translate(9.4707 20.4229)"
                    />
                  </clipPath>
                </defs>
              </svg>
              Тема на форуме
            </a>
          </div>
        </div>
      </div>

      {steamConfirmOpen && (
        <Modal
          title={t('settings.steam.confirmTitle')}
          closable
          onClose={() => setSteamConfirmOpen(false)}
        >
          <div className={s.confirm}>
            <p className={s.confirmBody}>{t('settings.steam.confirmBody')}</p>
            <div className={s.confirmActions}>
              <button
                type="button"
                className={s.confirmCancel}
                onClick={() => setSteamConfirmOpen(false)}
              >
                {t('settings.steam.confirmCancel')}
              </button>
              <button
                type="button"
                className={s.confirmDanger}
                onClick={() => void clearSteamSession()}
              >
                {t('settings.steam.confirmOk')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {langOpen && <LanguageModal onClose={() => setLangOpen(false)} />}
      {currencyOpen && <CurrencyModal onClose={() => setCurrencyOpen(false)} />}
    </>
  );
};
