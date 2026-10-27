import type { BrowserBookmark } from '@shared-types';
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { normalizeBookmarkUrl } from '~/features/settings/pages/browserBookmarks';
import s from './BookmarkEditor.module.scss';
import { useDialogFocus } from './dialogFocus';
import { L } from './strings';

export const EDITOR_W = 320;
/** `settings-patch`'s limits; main clips and checks again, this only keeps the fields from growing past them. */
const TITLE_MAX = 200;
const URL_MAX = 4096;

/** Where the bubble hangs from: the chip's left edge and bottom, in the toolbar view's coordinates. */
export interface EditorAnchor {
  left: number;
  bottom: number;
}

type EditorError = 'url' | 'duplicate' | 'failed';

interface BookmarkEditorProps {
  bookmark: BrowserBookmark;
  /** The whole bar, for the duplicate check: main refuses a URL another bookmark has, but cannot say why. */
  bookmarks: readonly BrowserBookmark[];
  anchor: EditorAnchor;
  /** What gets the focus back when the bubble closes. */
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Chrome's "Edit bookmark" bubble: a name and an address, saved through main — which validates it like any other
 * save — or dropped with Esc (the toolbar's own handler) or Cancel. A refusal keeps the bubble open with the reason.
 */
export const BookmarkEditor = ({
  bookmark,
  bookmarks,
  anchor,
  trigger,
  onClose,
}: BookmarkEditorProps) => {
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [error, setError] = useState<EditorError | null>(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const id = useId();

  useDialogFocus(true, panelRef, trigger, titleRef);
  // After the focus above: the name selected, so typing replaces it.
  useEffect(() => {
    alive.current = true;
    titleRef.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (saving) return;
    const next = normalizeBookmarkUrl(url);
    if (!next) {
      setError('url');
      urlRef.current?.focus();
      return;
    }
    if (bookmarks.some((b) => b.id !== bookmark.id && b.url === next)) {
      setError('duplicate');
      urlRef.current?.focus();
      return;
    }
    setSaving(true);
    let saved: BrowserBookmark | null = null;
    try {
      saved = await window.browserNav.bookmarkUpdate({
        id: bookmark.id,
        title: title.trim(),
        url: next,
      });
    } catch {
      saved = null;
    }
    if (!alive.current) return;
    if (saved) {
      onClose();
      return;
    }
    setSaving(false);
    setError('failed');
  };

  const message =
    error === 'url'
      ? L.bookmarkBadUrl
      : error === 'duplicate'
        ? L.bookmarkDuplicate
        : error === 'failed'
          ? L.bookmarkSaveFailed
          : null;
  const urlInvalid = error === 'url' || error === 'duplicate';

  return (
    <div
      ref={panelRef}
      className={s.editor}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      style={{
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - EDITOR_W - 8)),
        top: anchor.bottom + 6,
        width: EDITOR_W,
      }}
    >
      <h2 id={`${id}-title`} className={s.heading}>
        {L.bookmarkEditTitle}
      </h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className={s.field}>
          <span className={s.label}>{L.bookmarkName}</span>
          <input
            ref={titleRef}
            className={s.input}
            value={title}
            maxLength={TITLE_MAX}
            spellCheck={false}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error === 'failed') setError(null);
            }}
          />
        </label>
        <label className={s.field}>
          <span className={s.label}>{L.bookmarkUrl}</span>
          <input
            ref={urlRef}
            className={s.input}
            value={url}
            maxLength={URL_MAX}
            spellCheck={false}
            inputMode="url"
            aria-invalid={urlInvalid || undefined}
            aria-describedby={message ? `${id}-error` : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
          />
        </label>
        {message && (
          <p id={`${id}-error`} className={s.error} role="alert">
            {message}
          </p>
        )}
        <div className={s.actions}>
          <button type="button" className={s.button} onClick={onClose}>
            {L.cancel}
          </button>
          <button type="submit" className={`${s.button} ${s.primary}`} disabled={saving}>
            {L.save}
          </button>
        </div>
      </form>
    </div>
  );
};
