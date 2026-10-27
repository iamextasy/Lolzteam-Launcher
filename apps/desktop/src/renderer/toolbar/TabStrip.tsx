import type { BrowserTab } from '@shared-types';
import { Globe, Plus, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import s from './TabStrip.module.scss';
import { bookmarkHost, iconSrc } from './bookmarkFace';
import { IS_MAC, L } from './strings';

/** A tab's widest, and the room either end of the list keeps for the active tab's outer curves: mirrors the SCSS. */
const TAB_MAX = 240;
const CURVE = 8;
/** What closes the focused tab: a Mac laptop's Delete key is Backspace. */
const isCloseKey = (key: string): boolean => key === 'Delete' || (IS_MAC && key === 'Backspace');

/** A tab that has not been anywhere yet: the one "+" opens, or a link's before its page commits. */
export const isBlankUrl = (url: string): boolean => url === '' || url === 'about:blank';

/** The page's title; a tab that has been nowhere is a new tab; a page without a title is its site. */
export const tabLabel = (tab: BrowserTab): string => {
  const title = tab.title.trim();
  if (title && title !== 'about:blank') return title;
  if (isBlankUrl(tab.url)) return L.newTab;
  return bookmarkHost(tab.url) || tab.url;
};

/** The spinner while the page loads, then its favicon; a globe for a site that has none (or a broken one). */
const TabIcon = ({ tab }: { tab: BrowserTab }) => {
  const [broken, setBroken] = useState<string | null>(null);
  const src = iconSrc(tab.favicon);
  if (tab.isLoading) return <span className={`${s.icon} ${s.spinner}`} aria-hidden />;
  if (src && src !== broken) {
    return (
      <img className={s.icon} src={src} alt="" draggable={false} onError={() => setBroken(src)} />
    );
  }
  return <Globe className={`${s.icon} ${s.placeholder}`} size={16} aria-hidden />;
};

interface TabStripProps {
  tabs: readonly BrowserTab[];
  activeId: number | null;
  /** Runs before anything the strip does: the strip is above the backdrop, so a click here must close a menu itself. */
  onInteract: () => void;
}

/**
 * The window's tabs, Chrome's way: the active one joins the toolbar row under it, the others sit on the darker strip.
 * Every action goes to main, and the strip only ever draws the list main pushes back.
 */
export const TabStrip = ({ tabs, activeId, onInteract }: TabStripProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * A tab closed from the keyboard took the focus with it; the tab that takes its place gets it — main leaves the
   * keyboard with the strip for such a close, instead of handing it to that tab's page.
   */
  const refocus = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tabs.length` is not read here, but a tab added or closed moves the active one.
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`);
    if (!list || !el) return;
    // In view, with a little of its neighbours: a new tab lands at the end, past the scrolled-off part.
    const pad = 24;
    const left = el.offsetLeft - pad;
    const right = el.offsetLeft + el.offsetWidth + pad;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
    if (refocus.current) {
      refocus.current = false;
      el.querySelector<HTMLElement>('[role="tab"]')?.focus();
    }
  }, [activeId, tabs.length]);

  // The active tab too: the click took the keyboard from its page, and main gives it back, as Chrome does.
  const activate = (id: number): void => {
    onInteract();
    void window.browserNav.tabActivate(id).catch(() => undefined);
  };

  const close = (id: number, fromKeyboard = false): void => {
    onInteract();
    void window.browserNav.tabClose(id, fromKeyboard).catch(() => undefined);
  };

  const openTab = (): void => {
    onInteract();
    void window.browserNav.tabNew().catch(() => undefined);
  };

  // Arrows move the focus, Enter or Space switches: switching on every arrow would load each page on the way.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number, id: number): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = (index + 1) % all.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + all.length) % all.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = all.length - 1;
        break;
      default:
        if (!isCloseKey(e.key)) return;
        e.preventDefault();
        refocus.current = true;
        close(id, true);
        return;
    }
    e.preventDefault();
    all[next]?.focus();
  };

  // The middle button: a press would start autoscroll (Windows) or paste (Linux); its click closes the tab.
  const onMiddleDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };
  const onMiddleClick = (e: MouseEvent, id: number): void => {
    if (e.button !== 1) return;
    e.preventDefault();
    close(id);
  };

  // A mouse wheel scrolls up and down; over a strip that only scrolls sideways, that is what it means.
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    const list = listRef.current;
    if (!list || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    list.scrollLeft += e.deltaY;
  };

  // The active tab is the one Tab lands on; with none (before main's first word) the first one is.
  const focusable = tabs.some((t) => t.id === activeId) ? activeId : (tabs[0]?.id ?? null);

  return (
    <div className={s.strip}>
      <div
        ref={listRef}
        className={s.tabs}
        role="tablist"
        aria-label={L.tabs}
        aria-orientation="horizontal"
        // As wide as its tabs at full width, so "+" follows the last one; it shrinks from there to fit the window.
        style={{ flexBasis: tabs.length * TAB_MAX + 2 * CURVE }}
        onWheel={onWheel}
      >
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          const label = tabLabel(tab);
          return (
            <div
              key={tab.id}
              data-tab={tab.id}
              role="presentation"
              className={active ? `${s.tab} ${s.tabActive}` : s.tab}
              onMouseDown={onMiddleDown}
              onAuxClick={(e) => onMiddleClick(e, tab.id)}
            >
              <span className={s.divider} aria-hidden />
              <button
                type="button"
                role="tab"
                className={s.tabMain}
                aria-selected={active}
                aria-busy={tab.isLoading || undefined}
                aria-keyshortcuts={IS_MAC ? 'Delete Backspace' : 'Delete'}
                tabIndex={tab.id === focusable ? 0 : -1}
                title={label}
                onClick={() => activate(tab.id)}
                onKeyDown={(e) => onTabKey(e, i, tab.id)}
              >
                <TabIcon tab={tab} />
                <span className={s.title}>{label}</span>
              </button>
              {/*
                The mouse's way to close a tab. A tablist holds tabs and nothing else, so it is out of the Tab order and
                out of the accessibility tree: from the keyboard a tab closes with Delete, or Ctrl+W.
              */}
              <button
                type="button"
                className={s.close}
                tabIndex={-1}
                aria-hidden
                title={L.tabCloseHint}
                onClick={() => close(tab.id)}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={s.newTab}
        onClick={openTab}
        title={L.tabNew}
        aria-label={L.newTab}
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  );
};
