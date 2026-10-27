import type { BrowserBookmark, BrowserTab } from '@shared-types';
import { type CSSProperties, type MouseEvent, useState } from 'react';
import logoUrl from '~/assets/logolzt.svg';
import s from './TabCover.module.scss';
import { isBlankUrl } from './TabStrip';
import { bookmarkHost, bookmarkHue, bookmarkLabel, bookmarkLetter, iconSrc } from './bookmarkFace';
import { IS_MAC, L } from './strings';

/** Two rows of six: more is the bookmarks bar's job. */
export const MAX_TILES = 12;

/**
 * What stands in for the active tab's page while it has none to show — white, otherwise, at night. Exactly main's
 * rule (`isCovered`), which stretches the toolbar view over the whole window for the same tabs, so this is drawn
 * there: a blank tab is a new tab — loading its blank page or not — and one on its way to its first page is loading.
 * A blank tab a page's link opened (`adopted`) is neither: main leaves it uncovered, its opener may write into it.
 */
export const coverFor = (tab: BrowserTab | null): 'newTab' | 'loading' | null => {
  if (!tab) return null;
  if (isBlankUrl(tab.url)) return tab.adopted ? null : 'newTab';
  return tab.ready ? null : 'loading';
};

/** The site's favicon in a disc, or its first letter on its own colour — the bar's chip, a size up. */
const TileFace = ({ bookmark }: { bookmark: BrowserBookmark }) => {
  const [broken, setBroken] = useState<string | null>(null);
  const src = iconSrc(bookmark.icon);
  if (src && src !== broken) {
    return (
      <span className={s.face} aria-hidden>
        <img className={s.icon} src={src} alt="" draggable={false} onError={() => setBroken(src)} />
      </span>
    );
  }
  return (
    <span
      className={`${s.face} ${s.letter}`}
      style={{ '--hue': bookmarkHue(bookmark) } as CSSProperties}
      aria-hidden
    >
      {bookmarkLetter(bookmark)}
    </span>
  );
};

/** A blank tab's page, Chrome's way: the logo, where to type, and the bookmarks as tiles. */
export const NewTabPage = ({ bookmarks }: { bookmarks: readonly BrowserBookmark[] }) => {
  const tiles = bookmarks.slice(0, MAX_TILES);
  // Rows of even length: seven tiles are four and three, not six and one.
  const cols = tiles.length <= MAX_TILES / 2 ? tiles.length : Math.ceil(tiles.length / 2);

  const open = (b: BrowserBookmark, newTab: boolean): void => {
    void window.browserNav.bookmarkOpen(b.id, newTab).catch(() => undefined);
  };

  // The middle button: a press would start autoscroll (Windows) or paste (Linux); its click opens a new tab.
  const onMiddleDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };
  const onMiddleClick = (e: MouseEvent, b: BrowserBookmark): void => {
    if (e.button !== 1) return;
    e.preventDefault();
    open(b, true);
  };

  return (
    <div className={s.newTab}>
      <img className={s.logo} src={logoUrl} alt="" draggable={false} />
      <h1 className={s.heading}>{L.newTab}</h1>
      <p className={s.hint}>{tiles.length > 0 ? L.newTabHint : L.newTabHintNoBookmarks}</p>
      {tiles.length > 0 && (
        <nav
          className={s.tiles}
          aria-label={L.newTabBookmarks}
          style={{ '--cols': cols } as CSSProperties}
        >
          {tiles.map((b) => (
            <button
              key={b.id}
              type="button"
              className={s.tile}
              // Ctrl+click (⌘-click on macOS) opens it in a new tab, as a link does.
              onClick={(e) => open(b, IS_MAC ? e.metaKey : e.ctrlKey)}
              onMouseDown={onMiddleDown}
              onAuxClick={(e) => onMiddleClick(e, b)}
              title={`${bookmarkLabel(b)}\n${b.url}`}
            >
              <TileFace bookmark={b} />
              <span className={s.tileTitle}>{bookmarkLabel(b)}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
};

/** A spinner and the site on the way; it shows only once the load has taken a moment, so a quick one is just dark. */
export const LoadingCover = ({ url }: { url: string }) => {
  const host = isBlankUrl(url) ? '' : bookmarkHost(url);
  return (
    <div className={s.loading} role="status">
      <span className={s.spinner} aria-hidden />
      <span className={s.srOnly}>{L.loading}</span>
      {host && <span className={s.host}>{host}</span>}
    </div>
  );
};

interface TabCoverProps {
  /** The active tab; `null` before main's first word. */
  tab: BrowserTab | null;
  bookmarks: readonly BrowserBookmark[];
}

/**
 * The site area's stand-in, under the chrome rows and under an open menu's backdrop. A click on it does nothing:
 * it is the page, not a backdrop. It goes the moment the tab is `ready` — the tab view's own dark background is under it.
 */
export const TabCover = ({ tab, bookmarks }: TabCoverProps) => {
  const kind = coverFor(tab);
  if (!kind || !tab) return null;
  return (
    <div className={s.cover} data-cover={kind}>
      {kind === 'newTab' ? <NewTabPage bookmarks={bookmarks} /> : <LoadingCover url={tab.url} />}
    </div>
  );
};
