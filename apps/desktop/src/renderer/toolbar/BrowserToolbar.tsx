import type {
  BrowserBookmark,
  BrowserExtensionInfo,
  BrowserTabsState,
  ExtensionPage,
} from '@shared-types';
import { MAX_BROWSER_BOOKMARKS } from '@shared-types';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  ExternalLink,
  Mail,
  Puzzle,
  RotateCw,
  Star,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import logoUrl from '~/assets/logolzt.svg';
import { BookmarksBar } from './BookmarksBar';
import s from './BrowserToolbar.module.scss';
import { TabCover } from './TabCover';
import { TabStrip, isBlankUrl } from './TabStrip';
import type { NavState } from './bridge';
import { useDialogFocus } from './dialogFocus';
import { IS_MAC, L } from './strings';

const params = new URLSearchParams(location.search);
const emailEnabled = params.get('email') === '1';
const proxy = {
  enabled: params.get('proxy') === '1',
  label: params.get('label') ?? '',
  host: params.get('host') ?? '',
  port: params.get('port') ?? '',
  ms: params.get('ms') ?? '',
};

/**
 * The overlays drawn over the site. While one is open the toolbar view covers the whole
 * window (`expand`), the site dims under `.backdrop`, and a click on it or Esc closes it.
 * A new menu is a new member here and a `menu === '…'` branch below.
 */
export type MenuId =
  /** The active proxy card. */
  | 'proxy'
  /** The bookmarks that did not fit on the bar (»). */
  | 'overflow'
  /** One bookmark's right-click menu. */
  | 'bookmark'
  /** The bubble that edits that bookmark's name and address. */
  | 'bookmarkEdit'
  /** The extensions that have a page to open: a popup, an options page. */
  | 'extensions';

/** Mirrors `chromeHeight` in main: the tab strip, the toolbar row, and the bookmarks bar when it is drawn. */
const TABS_H = 40;
const TOOLBAR_H = 48;
const BOOKMARKS_BAR_H = 32;

const isWebPage = (url: string): boolean => /^https?:\/\//i.test(url);

/** A new tab's address bar is empty, as in Chrome, not `about:blank`. */
const shownUrl = (url: string): string => (isBlankUrl(url) ? '' : url);

export const BrowserToolbar = () => {
  const [state, setState] = useState<NavState>({
    url: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    title: '',
  });
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [ms, setMs] = useState(proxy.ms);
  const [testing, setTesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bookmarks, setBookmarks] = useState<readonly BrowserBookmark[]>([]);
  const [showBar, setShowBar] = useState(false);
  const [extensions, setExtensions] = useState<readonly BrowserExtensionInfo[]>([]);
  const [tabs, setTabs] = useState<BrowserTabsState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The tab the toolbar last saw active: `null` until main's first word. */
  const seenActive = useRef<number | null>(null);
  /** The address bar took the focus for a new tab, not because the user asked: the tab's page arriving ends that. */
  const autoFocused = useRef(false);
  const extButtonRef = useRef<HTMLButtonElement>(null);
  const extMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.browserNav.onState(setState), []);
  useEffect(
    () =>
      window.browserNav.onBookmarks((next) => {
        setBookmarks(next.bookmarks);
        setShowBar(next.showBar);
      }),
    [],
  );
  useEffect(() => window.browserNav.onExtensions(setExtensions), []);
  useEffect(() => window.browserNav.onTabs(setTabs), []);
  // Ctrl+L / F6: main has already given this view the keyboard.
  useEffect(
    () =>
      window.browserNav.onFocusAddress(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [],
  );

  const barVisible = showBar && bookmarks.length > 0;
  const chromeH = TABS_H + TOOLBAR_H + (barVisible ? BOOKMARKS_BAR_H : 0);

  // `.backdrop` starts where the chrome ends, and that moves with the bookmarks bar.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--chrome-h', `${chromeH}px`);
  }, [chromeH]);

  const display = editing ? draft : shownUrl(state.url);

  const activeTab = tabs?.tabs.find((t) => t.id === tabs.activeId) ?? null;
  const activeUrl = activeTab?.url ?? '';

  // A switch to a tab that has been nowhere yet — "+", Ctrl+T — is a switch to typing an address. The window's first
  // tab is not: it is the landing page on its way. Any other switch ends an edit begun on the tab before.
  useEffect(() => {
    if (!activeTab || activeTab.id === seenActive.current) return;
    const first = seenActive.current === null;
    seenActive.current = activeTab.id;
    const input = inputRef.current;
    if (!input) return;
    if (first || !isBlankUrl(activeTab.url)) {
      if (!first && document.activeElement === input) input.blur();
      return;
    }
    // Focus first: its handler fills the field from the state, which may still be the old tab's.
    input.focus();
    setDraft('');
    autoFocused.current = true;
  }, [activeTab]);

  // A link's new tab is blank only until its page commits; then the field shows where it went, unless typed into.
  useEffect(() => {
    if (!autoFocused.current || isBlankUrl(activeUrl) || draft !== '') return;
    autoFocused.current = false;
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
  }, [activeUrl, draft]);

  const submit = (): void => {
    const value = draft.trim();
    if (value) void window.browserNav.go(value);
    inputRef.current?.blur();
  };

  const copy = (): void => {
    void window.browserNav.copyUrl();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const openMenu = useCallback((id: MenuId): void => {
    setMenu(id);
    void window.browserNav.expand();
  }, []);

  const closeMenu = useCallback((): void => {
    setMenu(null);
    void window.browserNav.collapse();
  }, []);

  const toggleMenu = (id: MenuId): void => (menu === id ? closeMenu() : openMenu(id));

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, closeMenu]);

  // Main leaves Esc and macOS ⌘←/⌘→ to this view for the address bar's sake. With the focus anywhere else here —
  // on Back or Reload after a click — they mean what they mean on the page. An open menu takes Esc itself (above).
  const isLoading = state.isLoading;
  useEffect(() => {
    if (menu) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.target === inputRef.current || e.isComposing) return;
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (e.key === 'Escape' && plain && !e.metaKey) {
        if (isLoading) void window.browserNav.stop();
      } else if (IS_MAC && plain && e.metaKey) {
        if (e.key === 'ArrowLeft') void window.browserNav.back();
        else if (e.key === 'ArrowRight') void window.browserNav.forward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, isLoading]);

  // The bar went away (the last bookmark removed, or the bar switched off) under its own menu.
  useEffect(() => {
    if (!barVisible && (menu === 'overflow' || menu === 'bookmark' || menu === 'bookmarkEdit')) {
      closeMenu();
    }
  }, [barVisible, menu, closeMenu]);

  // An extension with nothing to open still runs on the sites; it just has no place in this menu.
  const withPages = extensions.filter((ext) => ext.hasPopup || ext.hasOptions);

  // The last one was switched off or removed (in the settings) while the menu was open.
  useEffect(() => {
    if (menu === 'extensions' && withPages.length === 0) closeMenu();
  }, [menu, withPages.length, closeMenu]);

  useDialogFocus(menu === 'extensions', extMenuRef, extButtonRef);

  const openExtension = (id: string, page: ExtensionPage): void => {
    void window.browserNav.extensionOpen(id, page).catch(() => undefined);
    closeMenu();
  };

  const pinned = bookmarks.find((b) => b.url === state.url) ?? null;
  const full = pinned === null && bookmarks.length >= MAX_BROWSER_BOOKMARKS;

  const toggleBookmark = (): void => {
    // The star follows the list main pushes back, not the click.
    if (pinned) void window.browserNav.bookmarkRemove(pinned.id).catch(() => undefined);
    else if (!full) void window.browserNav.bookmarkAdd().catch(() => undefined);
  };

  const recheck = async (): Promise<void> => {
    if (testing) return;
    setTesting(true);
    setFailed(false);
    try {
      const res = await window.browserNav.proxyRetest();
      if (res.ok) {
        setMs(String(res.ms));
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setTesting(false);
    }
  };

  const starTitle = pinned ? L.bookmarkRemove : full ? L.bookmarksFull : L.bookmarkAdd;
  const progress = state.isLoading ? <span className={s.progress} /> : null;

  return (
    <>
      {/* First: an open menu's backdrop dims it as it would the site. */}
      <TabCover tab={activeTab} bookmarks={bookmarks} />
      {menu && <div className={s.backdrop} role="presentation" onClick={closeMenu} />}
      <TabStrip
        tabs={tabs?.tabs ?? []}
        activeId={tabs?.activeId ?? null}
        onInteract={() => {
          if (menu) closeMenu();
        }}
      />
      <div className={barVisible ? `${s.bar} ${s.barJoined}` : s.bar}>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() => void window.browserNav.back()}
          disabled={!state.canGoBack}
          title={L.back}
          aria-label={L.back}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() => void window.browserNav.forward()}
          disabled={!state.canGoForward}
          title={L.forward}
          aria-label={L.forward}
        >
          <ArrowRight size={18} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() =>
            state.isLoading ? void window.browserNav.stop() : void window.browserNav.reload()
          }
          title={state.isLoading ? L.stop : L.reload}
          aria-label={state.isLoading ? L.stop : L.reload}
        >
          {state.isLoading ? <X size={18} /> : <RotateCw size={18} />}
        </button>

        <div className={s.address}>
          <input
            ref={inputRef}
            className={isWebPage(state.url) ? `${s.input} ${s.inputWithStar}` : s.input}
            value={display}
            spellCheck={false}
            placeholder={L.placeholder}
            onFocus={(e) => {
              setEditing(true);
              setDraft(shownUrl(state.url));
              e.target.select();
            }}
            onBlur={() => {
              setEditing(false);
              autoFocused.current = false;
            }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') {
                setEditing(false);
                inputRef.current?.blur();
              }
            }}
          />
          {isWebPage(state.url) && (
            <button
              type="button"
              className={pinned ? `${s.star} ${s.starOn}` : s.star}
              onClick={toggleBookmark}
              title={starTitle}
              aria-label={starTitle}
              aria-pressed={pinned !== null}
              aria-disabled={full}
            >
              <Star size={15} fill={pinned ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={s.iconBtn}
          onClick={copy}
          title={copied ? L.copied : L.copy}
          aria-label={L.copy}
        >
          <Copy size={16} className={copied ? s.copied : undefined} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          onClick={() => void window.browserNav.openExternal()}
          title={L.external}
          aria-label={L.external}
        >
          <ExternalLink size={16} />
        </button>
        {emailEnabled && (
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => void window.browserNav.openEmail()}
            title={L.email}
            aria-label={L.email}
          >
            <Mail size={16} />
          </button>
        )}

        {withPages.length > 0 && (
          <div className={s.menuWrap}>
            <button
              ref={extButtonRef}
              type="button"
              className={menu === 'extensions' ? `${s.iconBtn} ${s.iconBtnActive}` : s.iconBtn}
              onClick={() => toggleMenu('extensions')}
              title={L.extensions}
              aria-label={L.extensions}
              aria-expanded={menu === 'extensions'}
            >
              <Puzzle size={16} />
            </button>

            {menu === 'extensions' && (
              <div
                ref={extMenuRef}
                className={`${s.menu} ${s.extMenu}`}
                role="dialog"
                aria-modal="true"
                aria-label={L.extensions}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
              >
                <header className={s.menuHead}>
                  <h2 className={s.menuTitle}>{L.extensions}</h2>
                  <button
                    type="button"
                    className={s.menuClose}
                    onClick={closeMenu}
                    aria-label={L.close}
                  >
                    <X size={16} />
                  </button>
                </header>
                <ul className={s.extList}>
                  {withPages.map((ext) => (
                    <li key={ext.id} className={s.extRow}>
                      {ext.icon ? (
                        <img className={s.extIcon} src={ext.icon} alt="" />
                      ) : (
                        <span className={`${s.extIcon} ${s.extIconStub}`} aria-hidden>
                          <Puzzle size={13} />
                        </span>
                      )}
                      {/* The name on a line of its own: next to two buttons it would be cut to a few letters. */}
                      <div className={s.extBody}>
                        <span className={s.extName} title={ext.name}>
                          {ext.name}
                        </span>
                        <div className={s.extActions}>
                          {ext.hasPopup && (
                            <button
                              type="button"
                              className={s.extBtn}
                              onClick={() => openExtension(ext.id, 'popup')}
                              aria-label={`${L.extensionOpen}: ${ext.name}`}
                            >
                              {L.extensionOpen}
                            </button>
                          )}
                          {ext.hasOptions && (
                            <button
                              type="button"
                              className={s.extBtn}
                              onClick={() => openExtension(ext.id, 'options')}
                              aria-label={`${L.extensionOptions}: ${ext.name}`}
                            >
                              {L.extensionOptions}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className={s.menuNote}>{L.extensionsHint}</p>
              </div>
            )}
          </div>
        )}

        {proxy.enabled && (
          <div className={s.proxyWrap}>
            <button
              type="button"
              className={menu === 'proxy' ? `${s.proxyBtn} ${s.proxyBtnActive}` : s.proxyBtn}
              onClick={() => toggleMenu('proxy')}
              title={L.proxy}
              aria-label={L.proxy}
              aria-expanded={menu === 'proxy'}
            >
              <img className={s.proxyLogo} src={logoUrl} alt="" />
              <span className={s.proxyDot} />
            </button>

            {menu === 'proxy' && (
              <div
                className={s.menu}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
              >
                <header className={s.menuHead}>
                  <h2 className={s.menuTitle}>{L.proxyTitle}</h2>
                  <button
                    type="button"
                    className={s.menuClose}
                    onClick={closeMenu}
                    aria-label={L.close}
                  >
                    <X size={16} />
                  </button>
                </header>
                <dl className={s.rows}>
                  {proxy.label.trim() && (
                    <div className={s.row}>
                      <dt className={s.key}>{L.label}</dt>
                      <dd className={s.val}>{proxy.label}</dd>
                    </div>
                  )}
                  <div className={s.row}>
                    <dt className={s.key}>{L.address}</dt>
                    <dd className={s.val}>
                      {proxy.host}:{proxy.port}
                    </dd>
                  </div>
                  <div className={s.row}>
                    <dt className={s.key}>{L.latency}</dt>
                    <dd className={s.valGroup}>
                      <span className={s.val}>
                        {testing ? '…' : failed ? L.failed : ms ? `${ms} ms` : '—'}
                      </span>
                      <button
                        type="button"
                        className={s.recheck}
                        onClick={() => void recheck()}
                        disabled={testing}
                        aria-label={L.recheck}
                        title={L.recheck}
                      >
                        <RotateCw size={14} className={testing ? s.spin : undefined} />
                      </button>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )}
        {!barVisible && progress}
      </div>

      {barVisible && (
        <BookmarksBar
          bookmarks={bookmarks}
          menu={menu}
          onOpenMenu={openMenu}
          onCloseMenu={closeMenu}
        >
          {progress}
        </BookmarksBar>
      )}
    </>
  );
};
