import { Download, RefreshCw, RotateCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdater } from '~/stores/updater';
import s from './UpdateBanner.module.scss';

export const UpdateBanner = () => {
  const { t } = useTranslation();
  const { status, dismissed, setStatus, dismiss } = useUpdater();

  useEffect(() => {
    const off = window.launcher.updater.onStatus(setStatus);
    void window.launcher.updater.check();
    return off;
  }, [setStatus]);

  if (!status || dismissed) return null;

  const state = status.state;
  if (state === 'checking' || state === 'not-available') return null;

  const download = () => void window.launcher.updater.download();
  const install = () => void window.launcher.updater.install();

  let body: React.ReactNode = null;

  if (state === 'available') {
    body = (
      <>
        <div className={s.text}>
          <span className={s.title}>{t('update.available', { version: status.version })}</span>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={download}>
            <Download size={15} />
            <span>{t('update.download')}</span>
          </button>
          <button
            type="button"
            className={s.dismiss}
            onClick={dismiss}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
      </>
    );
  } else if (state === 'downloading') {
    body = (
      <>
        <div className={s.text}>
          <span className={s.title}>{t('update.downloading')}</span>
          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${status.percent}%` }} />
          </div>
        </div>
        <span className={s.percent}>{status.percent}%</span>
      </>
    );
  } else if (state === 'downloaded') {
    body = (
      <>
        <div className={s.text}>
          <span className={s.title}>{t('update.ready', { version: status.version })}</span>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={install}>
            <RotateCw size={15} />
            <span>{t('update.restart')}</span>
          </button>
          <button
            type="button"
            className={s.dismiss}
            onClick={dismiss}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className={s.text}>
          <span className={s.title}>{t('update.error')}</span>
          <span className={s.sub}>{status.message}</span>
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={s.primary}
            onClick={() => void window.launcher.updater.check()}
          >
            <RefreshCw size={15} />
            <span>{t('common.retry')}</span>
          </button>
          <button
            type="button"
            className={s.dismiss}
            onClick={dismiss}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
      </>
    );
  }

  return (
    <output className={`${s.banner} ${state === 'error' ? s.bannerError : ''}`}>{body}</output>
  );
};
