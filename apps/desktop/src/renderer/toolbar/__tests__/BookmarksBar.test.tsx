import type { BookmarkEdit, BrowserBookmark, BrowserBookmarksState } from '@shared-types';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BrowserToolbar } from '../BrowserToolbar';
import type { BrowserNavBridge } from '../bridge';
import { L } from '../strings';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const MARKET: BrowserBookmark = {
  id: 'bm-1',
  title: 'Market',
  url: 'https://market.example.test/',
  icon: PNG,
};
const FORUM: BrowserBookmark = { id: 'bm-2', title: 'Forum', url: 'https://forum.example.test/' };

/** The toolbar bridge with a bookmarks bar on it; `update` answers the editor's save. */
const setup = (
  update: (edit: BookmarkEdit) => Promise<BrowserBookmark | null> = async () => null,
) => {
  let bookmarksListener: ((state: BrowserBookmarksState) => void) | null = null;
  const call = () => vi.fn(async () => undefined);
  const off = () => () => undefined;
  const api = {
    expand: call(),
    collapse: call(),
    bookmarkOpen: call(),
    bookmarkRemove: call(),
    bookmarkUpdate: vi.fn(update),
    tabNew: call(),
    tabClose: call(),
    tabActivate: call(),
    onState: off,
    onTabs: off,
    onFocusAddress: off,
    onExtensions: off,
    onBookmarks: (cb: (state: BrowserBookmarksState) => void) => {
      bookmarksListener = cb;
      return () => {
        bookmarksListener = null;
      };
    },
  };
  window.browserNav = api as unknown as BrowserNavBridge;
  const showBookmarks = (bookmarks: readonly BrowserBookmark[]): void =>
    act(() => bookmarksListener?.({ bookmarks, showBar: true }));
  render(<BrowserToolbar />);
  showBookmarks([MARKET, FORUM]);
  return { api, showBookmarks };
};

const chip = (name: string): HTMLElement =>
  within(screen.getByRole('navigation', { name: L.bookmarksBar })).getByRole('button', {
    name: name,
  });

const openEditor = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  fireEvent.contextMenu(chip(name), { clientX: 10, clientY: 10 });
  await user.click(screen.getByRole('menuitem', { name: L.bookmarkEdit }));
  return screen.getByRole('dialog', { name: L.bookmarkEditTitle });
};

describe('BookmarksBar', () => {
  it('draws a favicon where there is one and the letter where there is not', () => {
    setup();
    expect(chip('Market').querySelector('img')).toHaveAttribute('src', PNG);
    expect(chip('Forum').querySelector('img')).toBeNull();
    expect(chip('Forum')).toHaveTextContent('F');
  });

  it('opens a bookmark here on a click, in a new tab on a middle or Ctrl click', async () => {
    const user = userEvent.setup();
    const { api } = setup();

    await user.click(chip('Market'));
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-1', false);

    await user.keyboard('{Control>}');
    await user.click(chip('Forum'));
    await user.keyboard('{/Control}');
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-2', true);

    fireEvent.mouseDown(chip('Market'), { button: 1 });
    fireEvent(
      chip('Market'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-1', true);
    expect(api.bookmarkOpen).toHaveBeenCalledTimes(3);
  });

  it('offers to open in a new tab, edit or delete on a right click', async () => {
    const user = userEvent.setup();
    const { api } = setup();

    fireEvent.contextMenu(chip('Forum'), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu', { name: 'Forum' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      L.bookmarkOpenNewTab,
      L.bookmarkEdit,
      L.bookmarkDelete,
    ]);
    // The keyboard is in the menu, and the arrows walk it.
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(items[2]).toHaveFocus();

    await user.click(items[0] as HTMLElement);
    expect(api.bookmarkOpen).toHaveBeenLastCalledWith('bm-2', true);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(chip('Forum'), { clientX: 10, clientY: 10 });
    await user.click(screen.getByRole('menuitem', { name: L.bookmarkDelete }));
    expect(api.bookmarkRemove).toHaveBeenCalledWith('bm-2');
  });

  it('edits a bookmark: the name selected, Enter saves through main', async () => {
    const user = userEvent.setup();
    const { api } = setup(async (edit) => ({ ...MARKET, ...edit }));

    const dialog = await openEditor(user, 'Market');
    const [name, address] = within(dialog).getAllByRole('textbox') as HTMLInputElement[];
    expect(name).toHaveFocus();
    expect(name?.selectionStart).toBe(0);
    expect(name?.selectionEnd).toBe('Market'.length);
    expect(address).toHaveValue(MARKET.url);

    await user.keyboard('Shop');
    await user.clear(address as HTMLInputElement);
    // A bare domain gets https://, as in the settings.
    await user.type(address as HTMLInputElement, 'shop.example.test{Enter}');
    expect(api.bookmarkUpdate).toHaveBeenCalledWith({
      id: 'bm-1',
      title: 'Shop',
      url: 'https://shop.example.test/',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.collapse).toHaveBeenCalled();
    // The keyboard goes back to the chip it was opened from.
    expect(chip('Market')).toHaveFocus();
  });

  it('keeps the editor open with the reason when the address will not do', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const dialog = await openEditor(user, 'Market');
    const address = within(dialog).getAllByRole('textbox')[1] as HTMLInputElement;

    await user.clear(address);
    await user.type(address, 'javascript:alert(1){Enter}');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(L.bookmarkBadUrl);
    expect(address).toHaveAttribute('aria-invalid', 'true');

    // Another bookmark's page.
    await user.clear(address);
    await user.type(address, `${FORUM.url}{Enter}`);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(L.bookmarkDuplicate);
    expect(api.bookmarkUpdate).not.toHaveBeenCalled();

    // Main refused it all the same.
    await user.clear(address);
    await user.type(address, 'https://other.example.test/{Enter}');
    expect(api.bookmarkUpdate).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(L.bookmarkSaveFailed);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('drops the edit on Esc and on Cancel', async () => {
    const user = userEvent.setup();
    const { api } = setup();

    await openEditor(user, 'Forum');
    await user.keyboard('Changed{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    const dialog = await openEditor(user, 'Forum');
    // A fresh form: the dropped draft is gone.
    expect(within(dialog).getAllByRole('textbox')[0]).toHaveValue('Forum');
    await user.click(within(dialog).getByRole('button', { name: L.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.bookmarkUpdate).not.toHaveBeenCalled();
  });

  it('closes the editor when its bookmark goes away', async () => {
    const user = userEvent.setup();
    const { showBookmarks } = setup();
    await openEditor(user, 'Forum');
    showBookmarks([MARKET]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
