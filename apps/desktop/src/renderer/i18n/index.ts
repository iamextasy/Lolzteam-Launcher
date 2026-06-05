import type { Locale } from '@shared-types';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const initI18n = async (initialLocale: Locale): Promise<void> => {
  if (i18n.isInitialized) {
    if (i18n.language !== initialLocale) {
      await i18n.changeLanguage(initialLocale);
    }
    return;
  }
  await i18n.use(initReactI18next).init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: initialLocale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
};

export { i18n };
