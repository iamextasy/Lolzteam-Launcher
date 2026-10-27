import type { BrowserTab } from '@shared-types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabStrip, isBlankUrl, tabLabel } from '../TabStrip';
import type { BrowserNavBridge } from '../bridge';
import { L } from '../strings';

/** The platform main passed in, settable per test. */
const platform = vi.hoisted(() => ({ mac: false }));
vi.mock('../strings', async (importActual) => {
  const actual = await importActual<typeof import('../strings')>();
  return {
    ...actual,
    get IS_MAC() {
      return platform.mac;
    },
  };
});

/** A 1×1 PNG: what a fetched favicon looks like to the strip. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const tab = (id: number, over: Partial<BrowserTab> = {}): BrowserTab => ({
  id,
  title: `Page ${id}`,
  url: `https://example.test/${id}`,
  favicon: null,
  isLoading: false,
  ready: true,
  adopted: false,
  ...over,
});

const setup = () => {
  const call = () => vi.fn(async () => undefined);
  const api = { tabNew: call(), tabClose: call(), tabActivate: call() };
  window.browserNav = api as unknown as BrowserNavBridge;
  return api;
};

const middleClick = (el: Element): void => {
  fireEvent.mouseDown(el, { button: 1 });
  fireEvent(el, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
};

describe('tab labels', () => {
  it('names a tab by its title, a new one as such, an untitled page by its site', () => {
    expect(tabLabel(tab(1, { title: ' Market ' }))).toBe('Market');
    expect(tabLabel(tab(1, { title: '', url: 'about:blank' }))).toBe(L.newTab);
    expect(tabLabel(tab(1, { title: 'about:blank', url: 'about:blank' }))).toBe(L.newTab);
    expect(tabLabel(tab(1, { title: '', url: '' }))).toBe(L.newTab);
    expect(tabLabel(tab(1, { title: '', url: 'https://www.example.test/a' }))).toBe('example.test');
  });

  it('knows a tab that has been nowhere', () => {
    expect(isBlankUrl('')).toBe(true);
    expect(isBlankUrl('about:blank')).toBe(true);
    expect(isBlankUrl('https://example.test/')).toBe(false);
  });
});

describe('TabStrip', () => {
  it('marks the active tab and switches on a click on another', async () => {
    const user = userEvent.setup();
    const api = setup();
    const onInteract = vi.fn();
    render(<TabStrip tabs={[tab(1), tab(2)]} activeId={2} onInteract={onInteract} />);

    const [first, second] = screen.getAllByRole('tab');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(second).toHaveAttribute('aria-selected', 'true');
    // One stop for Tab: the active tab.
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(second).toHaveAttribute('tabindex', '0');

    await user.click(first as HTMLElement);
    expect(api.tabActivate).toHaveBeenLastCalledWith(1);
    // The tab already in front too: main hands the keyboard the click took back to its page.
    await user.click(second as HTMLElement);
    expect(api.tabActivate).toHaveBeenLastCalledWith(2);
    // Every click closes whatever menu is open first.
    expect(onInteract).toHaveBeenCalledTimes(2);
  });

  it('closes a tab with its ×, with the middle button, and opens one with +', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<TabStrip tabs={[tab(1), tab(2)]} activeId={1} onInteract={() => undefined} />);

    await user.click(screen.getAllByTitle(L.tabCloseHint)[1] as HTMLElement);
    // From the mouse: the next tab's page takes the keyboard.
    expect(api.tabClose).toHaveBeenLastCalledWith(2, false);
    // The × closes its own tab and does not switch to it on the way.
    expect(api.tabActivate).not.toHaveBeenCalled();

    middleClick(screen.getAllByRole('tab')[0] as HTMLElement);
    expect(api.tabClose).toHaveBeenLastCalledWith(1, false);
    expect(api.tabClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: L.newTab }));
    expect(api.tabNew).toHaveBeenCalledTimes(1);
  });

  it('holds only tabs in its tablist: the × buttons are the mouse’s, out of the tree', () => {
    setup();
    render(<TabStrip tabs={[tab(1), tab(2)]} activeId={1} onInteract={() => undefined} />);
    const list = screen.getByRole('tablist');
    expect(within(list).queryAllByRole('button')).toEqual([]);
    const closes = screen.getAllByTitle(L.tabCloseHint);
    expect(closes).toHaveLength(2);
    for (const close of closes) {
      expect(close).toHaveAttribute('aria-hidden', 'true');
      expect(close).toHaveAttribute('tabindex', '-1');
    }
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-keyshortcuts', 'Delete');
  });

  it('draws the favicon, a spinner while loading, a placeholder without one', () => {
    setup();
    const { container } = render(
      <TabStrip
        tabs={[
          tab(1, { favicon: PNG }),
          tab(2, { favicon: PNG, isLoading: true }),
          tab(3),
          // Not a `data:` image: the toolbar's CSP would refuse it anyway.
          tab(4, { favicon: 'https://example.test/favicon.ico' }),
        ]}
        activeId={1}
        onInteract={() => undefined}
      />,
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', PNG);
    const [, loading, plain, remote] = screen.getAllByRole('tab');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(plain?.querySelector('svg')).not.toBeNull();
    expect(remote?.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the placeholder when the favicon will not draw', () => {
    setup();
    const { container } = render(
      <TabStrip tabs={[tab(1, { favicon: PNG })]} activeId={1} onInteract={() => undefined} />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('tab').querySelector('svg')).not.toBeNull();
  });

  it('moves the focus with the arrows, switches with Enter, closes with Delete', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<TabStrip tabs={[tab(1), tab(2), tab(3)]} activeId={1} onInteract={() => undefined} />);
    const tabs = screen.getAllByRole('tab');

    await user.tab();
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    // The focus moves; the page does not change until asked.
    expect(api.tabActivate).not.toHaveBeenCalled();
    await user.keyboard('{End}');
    expect(tabs[2]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tabs[0]).toHaveFocus();

    await user.keyboard('{ArrowRight}{Enter}');
    expect(api.tabActivate).toHaveBeenCalledWith(2);
    // Backspace is no Delete key off a Mac.
    await user.keyboard('{Backspace}');
    expect(api.tabClose).not.toHaveBeenCalled();
    // From the keyboard: the strip keeps it.
    await user.keyboard('{Delete}');
    expect(api.tabClose).toHaveBeenCalledWith(2, true);
  });

  it('closes a tab with a Mac’s Delete key, which is Backspace', async () => {
    platform.mac = true;
    try {
      const user = userEvent.setup();
      const api = setup();
      render(<TabStrip tabs={[tab(1), tab(2)]} activeId={1} onInteract={() => undefined} />);
      expect(screen.getAllByRole('tab')[0]).toHaveAttribute(
        'aria-keyshortcuts',
        'Delete Backspace',
      );
      await user.tab();
      await user.keyboard('{Backspace}');
      expect(api.tabClose).toHaveBeenCalledWith(1, true);
    } finally {
      platform.mac = false;
    }
  });

  it('gives the focus to the tab that takes the place of one closed from the keyboard', async () => {
    const user = userEvent.setup();
    setup();
    const { rerender } = render(
      <TabStrip tabs={[tab(1), tab(2)]} activeId={2} onInteract={() => undefined} />,
    );
    await user.tab();
    await user.keyboard('{Delete}');
    // Main closes it and pushes the rest.
    rerender(<TabStrip tabs={[tab(1)]} activeId={1} onInteract={() => undefined} />);
    expect(screen.getByRole('tab')).toHaveFocus();
  });
});
