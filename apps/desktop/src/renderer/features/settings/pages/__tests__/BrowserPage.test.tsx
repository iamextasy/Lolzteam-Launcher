import type { BrowserBookmark, LauncherSettings } from '@shared-types';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettings } from '~/stores/settings';
import { installLauncher } from '~/testing/launcher';
import { renderWithProviders, t } from '~/testing/render';
import { BrowserPage } from '../BrowserPage';

/** Synthetic: a PNG signature is enough for the `src`; jsdom decodes nothing. */
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

const ALPHA: BrowserBookmark = {
  id: 'bm-a',
  title: 'Alpha',
  url: 'https://alpha.example.test/',
  icon: ICON,
};
const BETA: BrowserBookmark = { id: 'bm-b', title: 'Beta', url: 'https://beta.example.test/' };

const show = (browserBookmarks: BrowserBookmark[]) => {
  useSettings.setState({
    settings: { browserBookmarks, browserBookmarksBar: true } as unknown as LauncherSettings,
  });
  installLauncher({
    extensions: { list: async () => [], onChanged: () => () => undefined },
  });
  return renderWithProviders(<BrowserPage />);
};

const rowOf = (title: string): HTMLElement => {
  const row = screen.getByText(title).closest('li');
  if (!row) throw new Error(`no row for ${title}`);
  return row;
};

describe('BrowserPage', () => {
  beforeEach(() => useSettings.setState({ settings: null }));
  afterEach(() => useSettings.setState({ settings: null }));

  it('shows a bookmark’s favicon, and the letter for one without', () => {
    show([ALPHA, BETA]);
    const alpha = rowOf('Alpha');
    expect(alpha.querySelector('img')?.getAttribute('src')).toBe(ICON);
    expect(within(alpha).queryByText('A')).toBeNull();

    const beta = rowOf('Beta');
    expect(beta.querySelector('img')).toBeNull();
    expect(within(beta).getByText('B')).toBeInTheDocument();
  });

  it('falls back to the letter when the icon does not decode, and tries a new one', () => {
    const view = show([ALPHA]);
    const img = rowOf('Alpha').querySelector('img');
    if (!img) throw new Error('no favicon');
    fireEvent.error(img);
    expect(rowOf('Alpha').querySelector('img')).toBeNull();
    expect(within(rowOf('Alpha')).getByText('A')).toBeInTheDocument();

    // A fresh icon from a later visit gets its chance.
    const fresh = `${ICON}AAAA`;
    useSettings.setState({
      settings: {
        browserBookmarks: [{ ...ALPHA, icon: fresh }],
        browserBookmarksBar: true,
      } as unknown as LauncherSettings,
    });
    view.rerender(<BrowserPage />);
    expect(rowOf('Alpha').querySelector('img')?.getAttribute('src')).toBe(fresh);
  });

  it('lists the tab shortcuts next to the others', () => {
    show([]);
    for (const id of ['newTab', 'closeTab', 'reopenTab', 'nextTab', 'prevTab', 'openBookmark']) {
      expect(screen.getByText(t(`settings.browser.hotkeys.${id}`))).toBeInTheDocument();
    }
    expect(screen.getByText(t('settings.browser.hotkeys.closeTabHint'))).toBeInTheDocument();
    expect(screen.getByText('F4')).toBeInTheDocument();
    expect(screen.getByText('PgDn')).toBeInTheDocument();
    expect(screen.getByText('PgUp')).toBeInTheDocument();
  });
});
