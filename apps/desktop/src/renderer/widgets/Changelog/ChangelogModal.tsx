import { useTranslation } from 'react-i18next';
import { CHANGELOG } from '~/data/changelog';
import { Modal } from '~/widgets/Modal/Modal';
import s from './ChangelogModal.module.scss';

interface ChangelogModalProps {
  currentVersion: string;
  onClose: () => void;
}

const formatDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));

export const ChangelogModal = ({ currentVersion, onClose }: ChangelogModalProps) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';

  return (
    <Modal title={t('changelog.title')} onClose={onClose}>
      <div className={s.list}>
        {CHANGELOG.map((entry) => {
          const isCurrent = entry.version === currentVersion;
          return (
            <section key={entry.version} className={s.entry}>
              <header className={s.entryHead}>
                <span className={s.version}>v{entry.version}</span>
                {isCurrent && <span className={s.currentTag}>{t('changelog.current')}</span>}
                <span className={s.date}>{formatDate(entry.date, i18n.language)}</span>
              </header>
              <ul className={s.changes}>
                {entry.changes[lang].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
};
