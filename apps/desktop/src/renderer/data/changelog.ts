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
    version: '0.7.1',
    date: '2026-07-08',
    changes: {
      ru: [
        'Добавлена настройка «Автозапуск игры при входе» в Steam: указываете App ID игры (например, 730 = CS2), и после входа в аккаунт Steam сразу запустит игру',
        'При нативном входе в Steam теперь отправляется стабильный machine_id (детерминированный от логина аккаунта), вход выглядит как настоящий Steam-клиент',
        'Исправлены работа тултипов',
      ],
      en: [
        'Added an "Auto-launch game on login" Steam setting: enter a game App ID (e.g. 730 = CS2), and after signing into a Steam account the game launches right away',
        'Native Steam sign-in now sends a stable machine_id (deterministic, seeded from the account login) — the sign-in looks like a real Steam client',
        'Fixed tooltip behavior',
      ],
    },
  },
  {
    version: '0.7.0',
    date: '2026-07-01',
    changes: {
      ru: [
        'Добавлена категория LLM - вход в аккаунты Claude, ChatGPT, Cursor и Grok через встроенный браузер',
        'Выбор способа входа: для сервисов с несколькими вариантами (Steam — клиент или браузер) показывается модалка «Как войти?» с галочкой «Запомнить выбор»',
        'Новая страница настроек «Способы входа» - задать способ входа по умолчанию для сервиса',
        'Вход в аккаунт по ссылке из браузерного расширения (поддержка DeepLink) - с подтверждением, выбором метода и прокси',
        'Вход в почту аккаунта: пункт «Почта» в карточке и иконка в браузере открывают письма ящика на странице «Почта»',
        'Системный трей: при закрытии окна приложение сворачивается в трей и продолжает работать в фоне',
        'Добавлена настройка обновления списка аккаунтов при запуске',
        'Добавлено фоновое автообновление аккаунтов (каждые 15/30/60 минут)',
        'Добавлена настройка числа потоков загрузки аккаунтов теперь список грузится быстрее',
        'Добавлена загрузка ваших прокси с форума одной кнопкой',
        'Чувствительные данные на диске (настройки, прокси, почты, кэш аккаунтов) теперь шифруются',
        'Исправлено: закрытие окна браузера полностью завершает сессию (раньше сайт продолжал работать в фоне)',
        'Исправлена повторная загрузка аккаунтов при переключении вкладок и разделов',
        'Исправлено кратковременное мигание настроек при открытии',
      ],
      en: [
        'Added the LLM category — sign in to Claude, ChatGPT, Cursor and Grok accounts via the built-in browser',
        'Sign-in method choice: for services with more than one option (Steam — app client or browser) a "How to sign in?" modal appears with a "Remember my choice" checkbox',
        'New Settings → "Sign-in methods" page to set the default sign-in method per service',
        'Sign in to an account via a link from the browser extension (deep-link support) — with confirmation, method and proxy pickers',
        'Open the account email: an "Email" item on the card and an icon in the browser open the mailbox on the Mail page',
        'System tray: closing the window minimizes the app to the tray and keeps it running in the background',
        'Added a setting to refresh the account list on launch',
        'Added background auto-refresh of accounts (every 15/30/60 minutes)',
        'Added an account-loading threads setting — the list now loads faster',
        'Added one-click import of your proxies from the forum',
        'Sensitive on-disk data (settings, proxies, mail, accounts cache) is now encrypted',
        'Fixed: closing the browser window now fully ends the session (previously the site kept running in the background)',
        'Fixed accounts re-loading when switching tabs and sections',
        'Fixed a brief flicker of the settings when opening them',
      ],
    },
  },
  {
    version: '0.6.0',
    date: '2026-06-12',
    changes: {
      ru: [
        'Добавлена возможность редактировать, удалять и создавать метки в вашем профиле',
        'Добавлена возможность использовать в самой программе Proxy',
        'Добавлена новая страница "Почта", теперь можно быстро просматривать письма с любой почты, вставив e-mail:password',
        'Добавлена возможность изменять лимит аккаунтов в настройках Telegram',
        'Исправлено отображение дробных цен',
        'Изменена фотография в установщике',
      ],
      en: [
        'Added editing, deleting and creating labels in your profile',
        'Added the ability to use a proxy inside the app itself',
        'Added a new "Mail" page — quickly view letters from any mailbox by pasting email:password',
        'Added an account-limit setting in Telegram settings',
        'Fixed display of fractional prices',
        'Changed the installer image',
      ],
    },
  },
  {
    version: '0.5.1',
    date: '2026-06-12',
    changes: {
      ru: [
        'Добавлен фильтр на исключение метки',
        'Улучшена работа с VPN',
        'Добавлен просмотр и вход в выложенные аккаунты',
      ],
      en: [
        'Added a filter to exclude labels',
        'Improved VPN handling',
        'Added browsing and logging in to uploaded accounts',
      ],
    },
  },
  {
    version: '0.5.0',
    date: '2026-06-11',
    changes: {
      ru: [
        'Вход в Steam через браузер',
        'Прокси для входа в Steam через браузер',
        'Редактирование меток аккаунтов',
        'Смена валюты',
        'Массовая проверка прокси',
        'Исправление ошибок',
      ],
      en: [
        'Steam sign-in via browser',
        'Proxy support for Steam browser sign-in',
        'Editing account labels',
        'Currency switching',
        'Bulk proxy checking',
        'Bug fixes',
      ],
    },
  },
  {
    version: '0.4.4',
    date: '2026-06-05',
    changes: {
      ru: ['Исправление работы приложения при неработающем API/интернете'],
      en: ['Fixed app behavior when the API/internet is unavailable'],
    },
  },
  {
    version: '0.4.3',
    date: '2026-06-02',
    changes: {
      ru: ['На странице входа добавлена информация о статусе подключения к API'],
      en: ['Added an API connection status indicator on the login screen'],
    },
  },
  {
    version: '0.4.2',
    date: '2026-06-02',
    changes: {
      ru: ['Редизайн страницы входа', 'Добавлен переключатель языка прямо на странице входа'],
      en: ['Redesigned the login screen', 'Added a language switcher right on the login screen'],
    },
  },
  {
    version: '0.4.1',
    date: '2026-06-02',
    changes: {
      ru: ['Исправление ошибок'],
      en: ['Bug fixes'],
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
      ru: ['Исправлен баг отображения перепроданных аккаунтов'],
      en: ['Fixed a bug with the display of resold accounts'],
    },
  },
  {
    version: '0.1.1',
    date: '2026-05-31',
    changes: {
      ru: ['Исправлена загрузка аккаунтов'],
      en: ['Fixed account loading'],
    },
  },
  {
    version: '0.1.0',
    date: '2026-05-31',
    changes: {
      ru: ['Релиз приложения'],
      en: ['Initial release'],
    },
  },
];
