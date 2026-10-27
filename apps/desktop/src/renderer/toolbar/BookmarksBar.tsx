import type { BrowserBookmark } from '@shared-types';
import { ChevronsRight, Pencil, SquarePlus, Trash2 } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { BookmarkEditor, EDITOR_W, type EditorAnchor } from './BookmarkEditor';
import s from './BookmarksBar.module.scss';
import type { MenuId } from './BrowserToolbar';
import { bookmarkHue, bookmarkLabel, bookmarkLetter, iconSrc } from './bookmarkFace';
import { useDialogFocus } from './dialogFocus';
import { IS_MAC, L } from './strings';

interface BookmarksBarProps {
  bookmarks: readonly BrowserBookmark[];
  menu: MenuId | null;
  onOpenMenu: (id: MenuId) => void;
  onCloseMenu: () => void;
  /** The loading line: it runs along the bottom of the chrome, which is this bar's bottom. */
  children?: ReactNode;
}

/** Where a right-click menu was asked for, for which bookmark, and where its editor would hang from. */
interface MenuTarget {
  id: string;
  x: number;
  y: number;
  anchor: EditorAnchor;
}

const CONTEXT_MENU_W = 240;

/** The site's favicon once main has one; until then (or if it will not draw) its first letter on its own colour. */
const Face = ({ bookmark }: { bookmark: BrowserBookmark }) => {
  const [broken, setBroken] = useState<string | null>(null);
  const src = iconSrc(bookmark.icon);
  if (src && src !== broken) {
    return (
      <img className={s.icon} src={src} alt="" draggable={false} onError={() => setBroken(src)} />
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

/** Up/Down, Home/End between a menu's items, as a `role="menu"` promises. */
const onMenuKeys = (e: KeyboardEvent<HTMLElement>): void => {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  switch (e.key) {
    case 'ArrowDown':
      next = (at + 1) % items.length;
      break;
    case 'ArrowUp':
      next = at <= 0 ? items.length - 1 : at - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  items[next]?.focus();
};

interface BookmarkMenuProps {
  bookmark: BrowserBookmark;
  target: MenuTarget;
  trigger: RefObject<HTMLElement | null>;
  onOpenNewTab: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

/** One bookmark's right-click menu: its first item takes the keyboard, and the chip gets it back. */
const BookmarkMenu = ({
  bookmark,
  target,
  trigger,
  onOpenNewTab,
  onEdit,
  onRemove,
}: BookmarkMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(true, menuRef, trigger, firstRef);

  return (
    <div
      ref={menuRef}
      className={s.contextMenu}
      role="menu"
      aria-label={bookmarkLabel(bookmark)}
      tabIndex={-1}
      onKeyDown={onMenuKeys}
      style={{
        left: Math.max(8, Math.min(target.x, window.innerWidth - CONTEXT_MENU_W - 8)),
        top: target.y + 4,
        width: CONTEXT_MENU_W,
      }}
    >
      <div className={s.menuHead}>
        <span className={s.menuHeadTitle}>{bookmarkLabel(bookmark)}</span>
        <span className={s.menuHeadUrl}>{bookmark.url}</span>
      </div>
      <button
        ref={firstRef}
        type="button"
        role="menuitem"
        className={s.item}
        onClick={onOpenNewTab}
      >
        <SquarePlus size={15} aria-hidden />
        <span className={s.itemTitle}>{L.bookmarkOpenNewTab}</span>
      </button>
      <button type="button" role="menuitem" className={s.item} onClick={onEdit}>
        <Pencil size={15} aria-hidden />
        <span className={s.itemTitle}>{L.bookmarkEdit}</span>
      </button>
      <hr className={s.separator} />
      <button
        type="button"
        role="menuitem"
        className={`${s.item} ${s.itemDanger}`}
        onClick={onRemove}
      >
        <Trash2 size={15} aria-hidden />
        <span className={s.itemTitle}>{L.bookmarkDelete}</span>
      </button>
    </div>
  );
};

/** The row under the address bar: one click opens a bookmark; what does not fit goes behind ». */
export const BookmarksBar = ({
  bookmarks,
  menu,
  onOpenMenu,
  onCloseMenu,
  children,
}: BookmarksBarProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  /** The chip (or », for a bookmark behind it) that the menu and the editor hand the keyboard back to. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** How many chips fit whole. The rest stay laid out (to be measured) but hidden. */
  const [fit, setFit] = useState(bookmarks.length);
  const [target, setTarget] = useState<MenuTarget | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bookmarks` is not read here, but every change to it is a new set of chips to measure.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = (): void => {
      const width = list.clientWidth;
      let n = 0;
      for (const chip of Array.from(list.children) as HTMLElement[]) {
        if (chip.offsetLeft + chip.offsetWidth > width) break;
        n += 1;
      }
      setFit(n);
    };
    measure();
    // The list narrows when » appears, which re-measures once more and settles.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [bookmarks]);

  const targeted = target ? bookmarks.find((b) => b.id === target.id) : undefined;
  const aboutTarget = menu === 'bookmark' || menu === 'bookmarkEdit';

  // The bookmark under an open menu or editor was removed (from another window, from the settings).
  useEffect(() => {
    if (aboutTarget && !targeted) onCloseMenu();
  }, [aboutTarget, targeted, onCloseMenu]);

  const overflow = bookmarks.slice(fit);

  const open = (b: BrowserBookmark, newTab = false): void => {
    void window.browserNav.bookmarkOpen(b.id, newTab).catch(() => undefined);
    if (menu) onCloseMenu();
  };

  // Ctrl+click (⌘-click on macOS) opens it in a new tab, as a link does.
  const onChipClick = (e: MouseEvent, b: BrowserBookmark): void =>
    open(b, IS_MAC ? e.metaKey : e.ctrlKey);

  // The middle button: a press would start autoscroll (Windows) or paste (Linux); its click opens a new tab.
  const onMiddleDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };
  const onMiddleClick = (e: MouseEvent, b: BrowserBookmark): void => {
    if (e.button !== 1) return;
    e.preventDefault();
    open(b, true);
  };

  const openContextMenu = (
    e: MouseEvent<HTMLElement>,
    b: BrowserBookmark,
    behindMore: boolean,
  ): void => {
    e.preventDefault();
    // Under the chip rather than at the pointer, so the menu does not cut through the bar; a
    // keyboard-raised one (no pointer position) lines up with the chip's left edge.
    const rect = e.currentTarget.getBoundingClientRect();
    const fromPointer = e.clientX !== 0 || e.clientY !== 0;
    // A bookmark behind » has no chip once its list closes: its editor hangs from » instead, right-aligned.
    const more = behindMore ? moreRef.current?.getBoundingClientRect() : undefined;
    const anchor = more
      ? { left: more.right - EDITOR_W, bottom: more.bottom }
      : { left: rect.left, bottom: rect.bottom };
    triggerRef.current = behindMore ? moreRef.current : e.currentTarget;
    setTarget({ id: b.id, x: fromPointer ? e.clientX : rect.left, y: rect.bottom, anchor });
    onOpenMenu('bookmark');
  };

  const remove = (id: string): void => {
    void window.browserNav.bookmarkRemove(id).catch(() => undefined);
    onCloseMenu();
  };

  return (
    <nav className={s.bar} aria-label={L.bookmarksBar}>
      <div className={s.list} ref={listRef}>
        {bookmarks.map((b, i) => {
          const hidden = i >= fit;
          const active = aboutTarget && target?.id === b.id;
          return (
            <button
              key={b.id}
              type="button"
              className={`${s.chip} ${hidden ? s.chipHidden : ''} ${active ? s.chipActive : ''}`}
              onClick={(e) => onChipClick(e, b)}
              onMouseDown={onMiddleDown}
              onAuxClick={(e) => onMiddleClick(e, b)}
              onContextMenu={(e) => openContextMenu(e, b, false)}
              title={`${bookmarkLabel(b)}\n${b.url}`}
              tabIndex={hidden ? -1 : undefined}
              aria-hidden={hidden || undefined}
            >
              <Face bookmark={b} />
              <span className={s.chipTitle}>{bookmarkLabel(b)}</span>
            </button>
          );
        })}
      </div>

      {overflow.length > 0 && (
        <div className={s.moreWrap}>
          <button
            ref={moreRef}
            type="button"
            className={menu === 'overflow' ? `${s.more} ${s.moreActive}` : s.more}
            onClick={() => (menu === 'overflow' ? onCloseMenu() : onOpenMenu('overflow'))}
            title={L.bookmarksMore}
            aria-label={L.bookmarksMore}
            aria-expanded={menu === 'overflow'}
          >
            <ChevronsRight size={16} />
          </button>

          {menu === 'overflow' && (
            <div className={s.menu} role="menu" aria-label={L.bookmarksMore} onKeyDown={onMenuKeys}>
              {overflow.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="menuitem"
                  className={s.item}
                  onClick={(e) => onChipClick(e, b)}
                  onMouseDown={onMiddleDown}
                  onAuxClick={(e) => onMiddleClick(e, b)}
                  onContextMenu={(e) => openContextMenu(e, b, true)}
                  title={b.url}
                >
                  <Face bookmark={b} />
                  <span className={s.itemTitle}>{bookmarkLabel(b)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {menu === 'bookmark' && target && targeted && (
        <BookmarkMenu
          bookmark={targeted}
          target={target}
          trigger={triggerRef}
          onOpenNewTab={() => open(targeted, true)}
          onEdit={() => onOpenMenu('bookmarkEdit')}
          onRemove={() => remove(targeted.id)}
        />
      )}
      {menu === 'bookmarkEdit' && target && targeted && (
        <BookmarkEditor
          // A fresh form per bookmark: a draft must not carry over to another one.
          key={targeted.id}
          bookmark={targeted}
          bookmarks={bookmarks}
          anchor={target.anchor}
          trigger={triggerRef}
          onClose={onCloseMenu}
        />
      )}
      {children}
    </nav>
  );
};
