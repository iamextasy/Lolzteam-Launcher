import { type BrowserBookmark, MAX_BROWSER_BOOKMARKS } from '@shared-types';
import { GripVertical, Plus } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLATFORM } from '~/lib/platform';
import { patchSettings, useSettings } from '~/stores/settings';
import { bookmarkHue, bookmarkLabel, bookmarkLetter, iconSrc } from '~/toolbar/bookmarkFace';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalField, ModalInput, ModalSpacer } from '~/widgets/Modal/ModalKit';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { SettingGroup, SettingNote, SettingRow, SettingToggle } from '../ui/SettingsControls';
import { PencilIcon, type SettingsIcon, TrashIcon } from '../ui/SettingsIcons';
import { ExtensionsSection } from './BrowserExtensions';
import s from './BrowserPage.module.scss';
import { type BookmarkDraftError, applyBookmarkDraft, moveBookmark } from './browserBookmarks';

/** Окно браузера с вкладкой и строками страницы — в одном наборе с остальными знаками рельса. */
export const BrowserIcon: SettingsIcon = ({ size = 20, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5 3H19A3.5 3.5 0 0 1 22.5 6.5V17.5A3.5 3.5 0 0 1 19 21H5A3.5 3.5 0 0 1 1.5 17.5V6.5A3.5 3.5 0 0 1 5 3ZM4.5 9.5V17A1.5 1.5 0 0 0 6 18.5H18A1.5 1.5 0 0 0 19.5 17V9.5ZM4.65 6.25A1.1 1.1 0 1 0 6.85 6.25A1.1 1.1 0 1 0 4.65 6.25ZM7.9 6.25A1.1 1.1 0 1 0 10.1 6.25A1.1 1.1 0 1 0 7.9 6.25Z"
      fill="currentColor"
    />
    <path
      d="M7.4 11.75H16.6A.9.9 0 0 1 16.6 13.55H7.4A.9.9 0 0 1 7.4 11.75ZM7.4 14.95H12.6A.9.9 0 0 1 12.6 16.75H7.4A.9.9 0 0 1 7.4 14.95Z"
      fill="currentColor"
    />
  </svg>
);

const IS_MAC = PLATFORM === 'darwin';
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const SHIFT = IS_MAC ? '⇧' : 'Shift';
/** Ctrl+Tab and Ctrl+PgDn/PgUp are the Control key on macOS too, as in Chrome. */
const CTRL = IS_MAC ? '⌃' : 'Ctrl';

/** Сочетание так, как его пишет система: ⌘D на macOS, Ctrl+D на остальных. */
const chordText = (keys: readonly string[]): string => keys.join(IS_MAC ? '' : '+');

type HotkeyId =
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'address'
  | 'stop'
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'nextTab'
  | 'prevTab'
  | 'bookmark'
  | 'openBookmark';

/** Та же таблица, что разбирает `main/adapters/browser/shortcuts.ts`, — здесь только для чтения. */
const HOTKEYS: readonly { id: HotkeyId; chords: readonly (readonly string[])[]; hint?: true }[] = [
  { id: 'reload', chords: [[MOD, 'R'], ['F5']] },
  {
    id: 'hardReload',
    // ⌘F5 is VoiceOver's on macOS: it never reaches the window.
    chords: IS_MAC
      ? [
          [MOD, SHIFT, 'R'],
          [SHIFT, 'F5'],
        ]
      : [
          [MOD, SHIFT, 'R'],
          [SHIFT, 'F5'],
          [MOD, 'F5'],
        ],
  },
  {
    id: 'back',
    chords: IS_MAC
      ? [
          ['⌘', '['],
          ['⌘', '←'],
        ]
      : [['Alt', '←']],
  },
  {
    id: 'forward',
    chords: IS_MAC
      ? [
          ['⌘', ']'],
          ['⌘', '→'],
        ]
      : [['Alt', '→']],
  },
  { id: 'address', chords: [[MOD, 'L'], ['F6']] },
  { id: 'stop', chords: [['Esc']], hint: true },
  { id: 'newTab', chords: [[MOD, 'T']] },
  {
    id: 'closeTab',
    chords: IS_MAC
      ? [['⌘', 'W']]
      : [
          [MOD, 'W'],
          [MOD, 'F4'],
        ],
    hint: true,
  },
  { id: 'reopenTab', chords: [[MOD, SHIFT, 'T']], hint: true },
  {
    id: 'nextTab',
    chords: IS_MAC
      ? [
          [CTRL, 'Tab'],
          [CTRL, 'PgDn'],
          ['⌘', '⇧', ']'],
          ['⌘', '⌥', '→'],
        ]
      : [
          [CTRL, 'Tab'],
          [CTRL, 'PgDn'],
        ],
  },
  {
    id: 'prevTab',
    chords: IS_MAC
      ? [
          [CTRL, '⇧', 'Tab'],
          [CTRL, 'PgUp'],
          ['⌘', '⇧', '['],
          ['⌘', '⌥', '←'],
        ]
      : [
          [CTRL, SHIFT, 'Tab'],
          [CTRL, 'PgUp'],
        ],
  },
  { id: 'bookmark', chords: [[MOD, 'D']] },
  { id: 'openBookmark', chords: [[MOD, '1…9']], hint: true },
];

/** Одно сочетание: клавиши-плашки, на Windows и Linux — через плюс. */
const Chord = ({ keys }: { keys: readonly string[] }) => (
  <span className={s.chord}>
    {keys.map((key, i) => (
      <span key={key} className={s.chordPart}>
        {i > 0 && !IS_MAC && <span className={s.plus}>+</span>}
        <kbd className={s.key}>{key}</kbd>
      </span>
    ))}
  </span>
);

/**
 * Значок сайта — тот же, что на панели закладок: его favicon, а пока его нет (закладку ещё не открывали) или
 * картинка не читается — первая буква сайта на его цвете.
 */
const Badge = ({ bookmark }: { bookmark: BrowserBookmark }) => {
  /** Какой значок не открылся: новый, пришедший из окна браузера, пробуем заново. */
  const [broken, setBroken] = useState<string | null>(null);
  // Та же проверка, что на панели: только картинка в `data:`, что бы ни лежало в файле настроек.
  const src = iconSrc(bookmark.icon);
  const icon = src && src !== broken ? src : null;
  if (icon) {
    return (
      <span className={`${s.badge} ${s.badgeIcon}`} aria-hidden>
        <img
          className={s.favicon}
          src={icon}
          alt=""
          draggable={false}
          onError={() => setBroken(icon)}
        />
      </span>
    );
  }
  return (
    <span
      className={s.badge}
      style={{ '--hue': bookmarkHue(bookmark) } as CSSProperties}
      aria-hidden
    >
      {bookmarkLetter(bookmark)}
    </span>
  );
};

export const BrowserPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const bookmarks = settings?.browserBookmarks ?? [];
  const showBar = settings?.browserBookmarksBar ?? true;
  const full = bookmarks.length >= MAX_BROWSER_BOOKMARKS;

  const [editing, setEditing] = useState<BrowserBookmark | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** Ручка, которой двигали с клавиатуры: после записи фокус возвращается к ней. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bookmarks` тело не читает, но строка переезжает, только когда список вернётся из настроек, — и узел ручки при этом может смениться: фокус ставим заново.
  useEffect(() => {
    if (focusId) handles.current.get(focusId)?.focus();
  }, [focusId, bookmarks]);

  const save = (next: BrowserBookmark[]) => void patchSettings({ browserBookmarks: next });

  const move = (from: number, to: number): boolean => {
    const next = moveBookmark(bookmarks, from, to);
    if (!next) return false;
    save(next);
    return true;
  };

  const drop = (targetId: string) => {
    const from = bookmarks.findIndex((b) => b.id === dragId);
    const to = bookmarks.findIndex((b) => b.id === targetId);
    setDragId(null);
    setOverId(null);
    move(from, to);
  };

  const moveByKey = (e: KeyboardEvent, index: number, id: string) => {
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    if (move(index, index + step)) setFocusId(id);
  };

  const remove = (id: string) => save(bookmarks.filter((b) => b.id !== id));

  return (
    <>
      <SettingGroup label={t('settings.browser.bookmarks.barSection')}>
        <SettingToggle
          title={t('settings.browser.bookmarks.barLabel')}
          description={t('settings.browser.bookmarks.barHint', { chord: chordText([MOD, 'D']) })}
          checked={showBar}
          onChange={() => void patchSettings({ browserBookmarksBar: !showBar })}
        />
      </SettingGroup>

      <section className={s.listSection}>
        <h3 className={s.sectionLabel}>{t('settings.browser.bookmarks.listSection')}</h3>

        <div className={s.listCard}>
          <div className={s.toolbar}>
            <div className={s.toolbarInfo}>
              <span className={s.listCount}>
                {t('settings.browser.bookmarks.count', { count: bookmarks.length })}
              </span>
              {full && (
                <span className={s.pill}>
                  {t('settings.browser.bookmarks.full', { max: MAX_BROWSER_BOOKMARKS })}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="accent"
              icon={Plus}
              disabled={full}
              onClick={() => setEditing('new')}
            >
              {t('settings.browser.bookmarks.add')}
            </Button>
          </div>

          {bookmarks.length === 0 ? (
            <p className={s.empty}>{t('settings.browser.bookmarks.empty')}</p>
          ) : (
            <ul className={s.list}>
              {bookmarks.map((b, index) => {
                const dropping = overId === b.id && dragId !== null && dragId !== b.id;
                return (
                  <li
                    key={b.id}
                    className={`${s.row} ${dragId === b.id ? s.rowDragging : ''} ${
                      dropping ? s.rowOver : ''
                    }`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(b.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      if (dragId === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (overId !== b.id) setOverId(b.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      drop(b.id);
                    }}
                  >
                    <Tooltip label={t('settings.browser.bookmarks.move')}>
                      <button
                        type="button"
                        className={s.dragHandle}
                        aria-label={t('settings.browser.bookmarks.move')}
                        onKeyDown={(e) => moveByKey(e, index, b.id)}
                        onBlur={() => setFocusId(null)}
                        ref={(el) => {
                          if (el) handles.current.set(b.id, el);
                          else handles.current.delete(b.id);
                        }}
                      >
                        <GripVertical size={15} />
                      </button>
                    </Tooltip>
                    <Badge bookmark={b} />
                    <div className={s.rowInfo}>
                      <span className={s.rowTitle}>{bookmarkLabel(b)}</span>
                      <span className={s.rowSub}>{b.url}</span>
                    </div>

                    {/* Ctrl+1…9 открывают первые девять — номер виден прямо у строки. */}
                    {index < 9 && (
                      <Tooltip
                        label={t('settings.browser.bookmarks.hotkey', {
                          chord: chordText([MOD, String(index + 1)]),
                        })}
                      >
                        <kbd className={s.slot}>{chordText([MOD, String(index + 1)])}</kbd>
                      </Tooltip>
                    )}

                    <div className={s.rowActions}>
                      <Tooltip label={t('settings.browser.bookmarks.edit')}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => setEditing(b)}
                          aria-label={t('settings.browser.bookmarks.edit')}
                        >
                          <PencilIcon size={15} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('settings.browser.bookmarks.delete')}>
                        <button
                          type="button"
                          className={`${s.iconBtn} ${s.iconBtnDanger}`}
                          onClick={() => remove(b.id)}
                          aria-label={t('settings.browser.bookmarks.delete')}
                        >
                          <TrashIcon size={15} />
                        </button>
                      </Tooltip>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <ExtensionsSection />

      <SettingGroup label={t('settings.browser.hotkeys.section')}>
        {HOTKEYS.map((hotkey) => (
          <SettingRow
            key={hotkey.id}
            title={t(`settings.browser.hotkeys.${hotkey.id}`)}
            description={hotkey.hint ? t(`settings.browser.hotkeys.${hotkey.id}Hint`) : undefined}
          >
            <span className={s.chords}>
              {hotkey.chords.map((keys, i) => (
                <span key={keys.join(' ')} className={s.alternative}>
                  {i > 0 && <span className={s.or}>{t('settings.browser.hotkeys.or')}</span>}
                  <Chord keys={keys} />
                </span>
              ))}
            </span>
          </SettingRow>
        ))}
        <SettingNote>{t('settings.browser.hotkeys.note')}</SettingNote>
      </SettingGroup>

      {editing && (
        <BookmarkModal
          bookmark={editing === 'new' ? null : editing}
          bookmarks={bookmarks}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
};

/* Идентификатор формы: кнопка сохранения стоит в футере каркаса — то есть вне формы. */
const BOOKMARK_FORM = 'browser-bookmark-form';

const ERROR_KEY: Record<BookmarkDraftError, string> = {
  url: 'settings.browser.bookmarks.errorUrl',
  duplicate: 'settings.browser.bookmarks.errorDuplicate',
  full: 'settings.browser.bookmarks.errorFull',
};

/** Добавить закладку или поправить название и адрес. */
const BookmarkModal = ({
  bookmark,
  bookmarks,
  onClose,
}: {
  bookmark: BrowserBookmark | null;
  bookmarks: readonly BrowserBookmark[];
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [url, setUrl] = useState(bookmark?.url ?? '');
  const [error, setError] = useState<BookmarkDraftError | null>(null);

  const submit = () => {
    const res = applyBookmarkDraft(bookmarks, { title, url }, bookmark?.id ?? null, () =>
      crypto.randomUUID(),
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    void patchSettings({ browserBookmarks: res.list });
    onClose();
  };

  return (
    <Modal
      title={
        bookmark
          ? t('settings.browser.bookmarks.editTitle')
          : t('settings.browser.bookmarks.addTitle')
      }
      {...(bookmark ? { subtitle: bookmarkLabel(bookmark) } : {})}
      size="sm"
      closable
      onClose={onClose}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('settings.browser.bookmarks.cancel')}
          </Button>
          {/* `form`, а не `onClick`: кнопка в футере каркаса, вне формы. */}
          <Button
            variant="accent"
            size="sm"
            type="submit"
            form={BOOKMARK_FORM}
            disabled={url.trim() === ''}
          >
            {t('settings.browser.bookmarks.save')}
          </Button>
        </>
      }
    >
      <form
        id={BOOKMARK_FORM}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ModalField label={t('settings.browser.bookmarks.fieldUrl')}>
          <ModalInput
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder={t('settings.browser.bookmarks.fieldUrlPlaceholder')}
            spellCheck={false}
            inputMode="url"
            autoFocus
          />
        </ModalField>
        <ModalField
          label={t('settings.browser.bookmarks.fieldTitle')}
          note={t('settings.browser.bookmarks.fieldTitleNote')}
        >
          <ModalInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('settings.browser.bookmarks.fieldTitlePlaceholder')}
            maxLength={200}
            spellCheck={false}
          />
        </ModalField>
        <ModalError>
          {error ? t(ERROR_KEY[error], { max: MAX_BROWSER_BOOKMARKS }) : null}
        </ModalError>
      </form>
    </Modal>
  );
};
