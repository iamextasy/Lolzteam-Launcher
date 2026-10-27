import { MAX_BROWSER_BOOKMARKS } from '@shared-types';

const params = new URLSearchParams(location.search);

/** The app's language, which main passes in; the system's only if it did not. */
export const LANG: 'ru' | 'en' = (params.get('lang') ?? navigator.language)
  .toLowerCase()
  .startsWith('ru')
  ? 'ru'
  : 'en';

/** From main, not from the user agent: the app sets one UA for every platform. */
export const IS_MAC = params.get('os') === 'darwin';

/** A shortcut as the platform writes it: ⌘D on macOS, Ctrl+D elsewhere. */
const chord = (key: string): string => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`);

/** The toolbar has no i18next: this one dictionary per language is all of its text. */
const RU = {
  back: 'Назад',
  forward: 'Вперёд',
  reload: 'Обновить',
  stop: 'Остановить',
  copy: 'Копировать ссылку',
  copied: 'Скопировано',
  external: 'Открыть во внешнем браузере',
  email: 'Почта аккаунта',
  placeholder: 'Введите адрес или запрос',
  proxy: 'Прокси',
  proxyTitle: 'Активный прокси',
  label: 'Название',
  address: 'Адрес',
  latency: 'Задержка',
  recheck: 'Проверить заново',
  failed: 'Ошибка',
  close: 'Закрыть',
  bookmarkAdd: `Добавить в закладки (${chord('D')})`,
  bookmarkRemove: 'Убрать из закладок',
  bookmarksFull: `Закладок уже ${MAX_BROWSER_BOOKMARKS} — уберите лишние в настройках`,
  bookmarksBar: 'Панель закладок',
  bookmarksMore: 'Остальные закладки',
  bookmarkDelete: 'Удалить',
  bookmarkOpenNewTab: 'Открыть в новой вкладке',
  bookmarkEdit: 'Изменить',
  bookmarkEditTitle: 'Изменить закладку',
  bookmarkName: 'Название',
  bookmarkUrl: 'Адрес',
  bookmarkBadUrl: 'Это не адрес сайта',
  bookmarkDuplicate: 'Такая закладка уже есть',
  bookmarkSaveFailed: 'Не удалось сохранить закладку',
  save: 'Сохранить',
  cancel: 'Отмена',
  tabs: 'Вкладки',
  newTab: 'Новая вкладка',
  tabNew: `Новая вкладка (${chord('T')})`,
  tabCloseHint: `Закрыть вкладку (${chord('W')})`,
  newTabHint: 'Введите адрес вверху или откройте закладку',
  newTabHintNoBookmarks: 'Введите адрес в строке вверху',
  newTabBookmarks: 'Закладки',
  loading: 'Загрузка',
  extensions: 'Расширения',
  extensionOpen: 'Открыть',
  extensionOptions: 'Настройки',
  extensionsHint:
    'Установить, выключить или удалить расширение — в настройках лаунчера, раздел «Браузер».',
};

const EN: typeof RU = {
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  stop: 'Stop',
  copy: 'Copy link',
  copied: 'Copied',
  external: 'Open in external browser',
  email: 'Account email',
  placeholder: 'Search or enter address',
  proxy: 'Proxy',
  proxyTitle: 'Active proxy',
  label: 'Label',
  address: 'Address',
  latency: 'Latency',
  recheck: 'Re-check',
  failed: 'Failed',
  close: 'Close',
  bookmarkAdd: `Bookmark this page (${chord('D')})`,
  bookmarkRemove: 'Remove bookmark',
  bookmarksFull: `Already ${MAX_BROWSER_BOOKMARKS} bookmarks — remove some in the settings`,
  bookmarksBar: 'Bookmarks bar',
  bookmarksMore: 'More bookmarks',
  bookmarkDelete: 'Delete',
  bookmarkOpenNewTab: 'Open in new tab',
  bookmarkEdit: 'Edit',
  bookmarkEditTitle: 'Edit bookmark',
  bookmarkName: 'Name',
  bookmarkUrl: 'URL',
  bookmarkBadUrl: 'That is not a web address',
  bookmarkDuplicate: 'This page is already bookmarked',
  bookmarkSaveFailed: 'Could not save the bookmark',
  save: 'Save',
  cancel: 'Cancel',
  tabs: 'Tabs',
  newTab: 'New tab',
  tabNew: `New tab (${chord('T')})`,
  tabCloseHint: `Close tab (${chord('W')})`,
  newTabHint: 'Type an address above or open a bookmark',
  newTabHintNoBookmarks: 'Type an address in the bar above',
  newTabBookmarks: 'Bookmarks',
  loading: 'Loading',
  extensions: 'Extensions',
  extensionOpen: 'Open',
  extensionOptions: 'Options',
  extensionsHint:
    'Install, turn off or remove extensions in the launcher’s settings, under Browser.',
};

export const L = LANG === 'ru' ? RU : EN;
