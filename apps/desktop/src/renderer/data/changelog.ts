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
    version: '1.2.0',
    date: '2026-10-27',
    changes: {
      ru: [
        'Во встроенном браузере появились вкладки. Работают привычные Ctrl+T, Ctrl+W, Ctrl+Tab и Ctrl+Shift+T, вкладку можно закрыть средним кликом',
        'Добавили закладки. Страницу можно сохранить звёздочкой в адресной строке или через Ctrl+D, а открыть с панели под адресом или по Ctrl+1…9. Править и сортировать закладки можно в настройках, в разделе «Браузер»',
        'В браузер можно ставить расширения Chrome: по ссылке из Chrome Web Store, из файла .crx/.zip или из папки. Steam Inventory Helper работает, кнопка «Взять всё» в трейдах тоже',
        'Новые горячие клавиши: Ctrl+R и F5 обновляют страницу, Alt+← и Alt+→ листают назад и вперёд, Ctrl+L переводит в адресную строку, Esc останавливает загрузку',
        'Убрали белые вспышки при загрузке страниц и открытии новой вкладки. На новой вкладке теперь видны ваши закладки',
      ],
      en: [
        'The built-in browser now has tabs. The usual Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+T work, and a middle-click closes a tab',
        'Bookmarks are here. Save a page with the star in the address bar or Ctrl+D, then open it from the bar under the address or with Ctrl+1…9. Edit and reorder bookmarks in Settings, under Browser',
        'You can install Chrome extensions in the browser: from a Chrome Web Store link, a .crx/.zip file or a folder. Steam Inventory Helper works, including the «Take all» button in trades',
        'New shortcuts: Ctrl+R and F5 reload, Alt+← and Alt+→ go back and forward, Ctrl+L jumps to the address bar, Esc stops loading',
        'No more white flashes while a page loads or a new tab opens. A new tab now shows your bookmarks',
      ],
    },
  },
  {
    version: '1.1.1',
    date: '2026-10-14',
    changes: {
      ru: [
        'Доработка под предстоящее обновление API Маркета: с 1 ноября списки аккаунтов загружаются по новой курсорной пагинации',
        'Аккаунт больше не может попасть в список дважды, если база менялась во время загрузки',
        'Переход на новые домены: lolz.team вместо lolz.live, api.* вместо prod-api.*',
      ],
      en: [
        'Prepared for the upcoming Market API update: from 1 November, account lists load with the new cursor-based pagination',
        'An account can no longer appear twice in the list if the base changed while it was loading',
        'Moved to the new domains: lolz.team instead of lolz.live, api.* instead of prod-api.*',
      ],
    },
  },
  {
    version: '1.1.0',
    date: '2026-09-16',
    changes: {
      ru: [
        'Поддержка macOS: сборки для Apple Silicon и Intel, вход в Steam и Telegram Desktop',
        'Поддержка Linux: сборки AppImage и .deb',
        'Новый сервис - EA Desktop (только Windows)',
        'Гарантия при входе в Steam больше не тратится зря: код Steam Guard берётся из данных товара, затем из привязанного SDA, затем разовым кодом с маркета, а maFile - последним и только с вашего подтверждения',
        'Исправлен бейдж гарантии: у купленных аккаунтов виден реальный срок',
        'Редактирование своих лотов целиком: название, описание, приватная информация, происхождение, тип почты и цена с подсказками маркета',
        'Поднятие лота кнопкой на карточке и авто-подъём с выбором интервала',
        'Снять лот с продажи и вернуть, закрепить в топе, пересчитать инвентарь Steam',
        'Монитор API в настройках: остаток лимита, запросы за час и за минуту, история',
        'Фильтры переехали в диалог на две колонки: цена «от» и «до» и 22 новых фильтра по категориям',
        'Ошибки и сообщения при входе переводятся на язык интерфейса',
        'Исправления: выпадающий список «Все сервисы» не обрезается шапкой, привязка SDA не зависает, код Steam Guard с буквами больше не теряется, просроченный код с почты запрашивается заново',
      ],
      en: [
        'macOS support: builds for Apple Silicon and Intel, with Steam and Telegram Desktop sign-in',
        'Linux support: AppImage and .deb builds',
        'New service — EA Desktop (Windows only)',
        'Signing into Steam no longer spends the guarantee for nothing: the Steam Guard code comes from the item data, then a linked SDA, then a one-time code from the market, and the maFile last, only after you confirm',
        'Fixed the guarantee badge: bought accounts now show the real remaining time',
        'Edit your own listings in full: title, description, private information, origin, email type and price with market suggestions',
        'Bump a listing from a button on the card, and auto-bump with a chosen interval',
        'Take a listing off sale and back, pin it to the top, recount the Steam inventory',
        'API monitor in settings: remaining limit, requests per hour and per minute, and a history',
        'Filters moved into a two-column dialog: a price from/to window and 22 new filters across categories',
        'Sign-in errors and messages are translated to the interface language',
        'Fixes: the "All services" dropdown is no longer clipped by the header, linking an SDA no longer hangs, a Steam Guard code with letters is no longer discarded, an expired mail code is re-requested',
      ],
    },
  },
  {
    version: '1.0.0',
    date: '2026-08-13',
    changes: {
      ru: [
        'Полный редизайн приложения',
        'Локальная база аккаунтов — новое направление: в неё можно добавлять аккаунты Steam и Telegram. Для Steam доступны SDA, проверка валидности и удаление друзей; для Telegram — проверка валидности, заполнение профилей, удаление чатов и каналов и настройка параметров конфиденциальности',
        'Настройки разбиты на разделы: приложение, аккаунты, сеть, сервисы, система',
        'Поиск теперь ищет ещё и по папке, заметке, меткам, играм Steam и данным собственной проверки',
        'Свои метки с палитрой на восемь цветов, свои папки и заметки к аккаунтам; фильтры запоминаются отдельно для каждой категории',
        'Список аккаунтов переписан на виртуализацию: сколько бы аккаунтов ни было в базе, в интерфейсе живут только видимые строки. Прокрутка на тысячах аккаунтов идёт без рывков и без подгрузки кусками, а переключение таблица ↔ карточки оставляет вас на том же аккаунте',
        'Добавлен SDA: подтверждение входа по QR-коду и управление мобильными подтверждениями (обмены, лоты, восстановление, API-ключи) с возможностью разрешить или отклонить',
        'В почте появился поиск по письмам и быстрое копирование кода',
        'Добавлены уведомления о завершённых задачах — на рабочий стол и в самом приложении',
        'Добавлен журнал действий: что выполняло приложение, каков был результат и сколько времени это заняло',
        'Добавлена анонимная метрика использования — по желанию и с вашего согласия',
        'Исправления ошибок',
      ],
      en: [
        'Complete redesign of the app',
        'Local account database — a new direction: Steam and Telegram accounts can be added to it. Steam brings SDA, validity checks and friend removal; Telegram brings validity checks, profile filling, chat and channel deletion and privacy settings',
        'Settings are split into sections: app, accounts, network, services, system',
        'Search now also covers the folder, note, labels, Steam games and your own check results',
        'Your own labels with an eight-colour palette, your own folders and notes on accounts; filters are remembered per category',
        'The account list is now virtualized: however many accounts the database holds, only the visible rows exist in the interface. Scrolling through thousands of accounts is smooth and loads nothing in chunks, and switching table ↔ cards keeps you on the same account',
        'Added SDA: QR-code sign-in confirmation and mobile confirmation management (trades, listings, recovery, API keys) with approve and decline',
        'Mail got letter search and one-click code copying',
        'Added notifications about finished tasks — on the desktop and inside the app',
        'Added an action log: what the app did, how it ended and how long it took',
        'Added anonymous usage metrics — optional, and only with your consent',
        'Bug fixes',
      ],
    },
  },
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
