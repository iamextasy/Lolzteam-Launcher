export interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    ru: string[];
    en: string[];
  };
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.4.3',
    date: '2026-06-02',
    changes: {
      ru: [
        'На странице входа добавлена информация о статусе подключения к API',
      ],
      en: [
        'Added an API connection status indicator on the login screen',
      ],
    },
  },
  {
    version: '0.4.2',
    date: '2026-06-02',
    changes: {
      ru: [
        'Редизайн страницы входа',
        'Добавлен переключатель языка прямо на странице входа',
      ],
      en: [
        'Redesigned the login screen',
        'Added a language switcher right on the login screen',
      ],
    },
  },
  {
    version: '0.4.1',
    date: '2026-06-02',
    changes: {
      ru: [
        'Исправление ошибок',
      ],
      en: [
        'Bug fixes',
      ],
    },
  },
  {
    version: '0.4.0',
    date: '2026-06-02',
    changes: {
      ru: [
        'Добавлена поддержка HTTP IPv4-прокси (Telegram, TikTok, Instagram, Discord)',
        'Добавлен фильтр аккаунтов по валидности',
        'Две новые категории: Instagram и Discord (вход через браузер)',
        'Добавлен список изменений (этот экран)',
      ],
      en: [
        'Added HTTP IPv4 proxy support (Telegram, TikTok, Instagram, Discord)',
        'Added an account filter by validity',
        'Two new categories: Instagram and Discord (browser login)',
        'Added a changelog (this screen)',
      ],
    },
  },
  {
    version: '0.3.0',
    date: '2026-06-01',
    changes: {
      ru: [
        'Исправлено отображение валидности аккаунта',
        'Добавлена возможность проверить аккаунт на валид и открыть его на маркете',
        'Исправлено отображение блокировок аккаунта в Steam',
        'Добавлено отображение меток',
        'Добавлена возможность очистить весь список сессий Steam',
        'Добавлена кнопка проверки обновлений',
      ],
      en: [
        'Fixed account validity display',
        'Check an account for validity and open it on the market',
        'Fixed Steam account ban display',
        'Added account tags display',
        'Clear the entire list of Steam sessions',
        'Added a “Check for updates” button',
      ],
    },
  },
  {
    version: '0.2.0',
    date: '2026-05-31',
    changes: {
      ru: [
        'Метод входа в аккаунт изменён на офлайн-восстановление сессии вместо входа по коду',
        'Исправлено закрытие всех клиентов Telegram при входе — теперь закрывается только указанный в настройках',
        'Небольшие фиксы для корректной работы с форками',
        'На вкладке конкретной категории (например, Telegram) кнопка «Обновить» теперь обновляет только эту категорию, а не все',
      ],
      en: [
        'Switched account login to offline session restore instead of code login',
        'Fixed closing of all Telegram clients on login — now only the one set in settings is closed',
        'Minor fixes for proper work with forks',
        'On a specific category tab (e.g. Telegram), the “Refresh” button now refreshes only that category, not all of them',
      ],
    },
  },
  {
    version: '0.1.2',
    date: '2026-05-31',
    changes: {
      ru: [
        'Исправлен баг отображения перепроданных аккаунтов',
      ],
      en: [
        'Fixed a bug with the display of resold accounts',
      ],
    },
  },
  {
    version: '0.1.1',
    date: '2026-05-31',
    changes: {
      ru: [
        'Исправлена загрузка аккаунтов',
      ],
      en: [
        'Fixed account loading',
      ],
    },
  },
  {
    version: '0.1.0',
    date: '2026-05-31',
    changes: {
      ru: [
        'Релиз приложения',
      ],
      en: [
        'Initial release',
      ],
    },
  },
];
