import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import type { BrowserWindow, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MAIN_COLORS } from '../../../theme';
import {
  PAGE_BASE_DARK,
  PAGE_BASE_LIGHT,
  PAINTS_OWN_BACKGROUND,
  followPageBackground,
  followWindowBackground,
  isBlankUrl,
} from '../page-background';

/** A `WebContents` as far as the background rule touches it; what the page answers is set per test. */
class FakeContents extends EventEmitter {
  url = '';
  destroyed = false;
  answer: () => unknown = () => true;
  executeJavaScriptInIsolatedWorld = vi.fn(
    async (_world: number, _scripts: { code: string }[]): Promise<unknown> => this.answer(),
  );
  getURL() {
    return this.url;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

const follow = () => {
  const wc = new FakeContents();
  const apply = vi.fn<(color: string) => void>();
  followPageBackground(wc as unknown as WebContents, apply);
  const last = () => apply.mock.calls.at(-1)?.[0];
  return { wc, apply, last };
};

/** A document committed and its DOM ready, then the page's answer in. */
const showPage = async (wc: FakeContents, url: string, paintsOwn: unknown) => {
  wc.url = url;
  wc.answer = () => paintsOwn;
  wc.emit('did-navigate');
  wc.emit('dom-ready');
  await vi.waitFor(() => expect(wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
};

const failLoad = (wc: FakeContents, code: number, isMainFrame = true) =>
  wc.emit('did-fail-provisional-load', {}, code, 'ERR', wc.url, isMainFrame);

describe('isBlankUrl', () => {
  it('is a tab with nothing of its own in it', () => {
    expect(isBlankUrl('')).toBe(true);
    expect(isBlankUrl('about:blank')).toBe(true);
    expect(isBlankUrl('https://example.com/')).toBe(false);
    expect(isBlankUrl('about:blank#x')).toBe(false);
  });
});

describe('followPageBackground', () => {
  it('starts dark: the launcher’s own background', () => {
    const { apply } = follow();
    expect(PAGE_BASE_DARK).toBe(MAIN_COLORS.bg);
    expect(apply.mock.calls).toEqual([[PAGE_BASE_DARK]]);
  });

  it('gives a page that leaves its canvas to Chromium Chromium’s white — its text is black', async () => {
    const { wc, last } = follow();
    await showPage(wc, 'https://plain.example/502', false);
    expect(last()).toBe(PAGE_BASE_LIGHT);
    const [world, scripts] = wc.executeJavaScriptInIsolatedWorld.mock.calls[0] ?? [];
    // Asked in a world of its own: never the page's (0) nor Electron's (999).
    expect([0, 999]).not.toContain(world);
    expect(scripts).toEqual([{ code: PAINTS_OWN_BACKGROUND }]);
  });

  it('keeps the dark under a page with a background of its own, and for any answer but a plain no', async () => {
    for (const answer of [true, null, undefined, 'false', 0, {}]) {
      const { wc, apply } = follow();
      await showPage(wc, 'https://dark.example/', answer);
      expect(apply.mock.calls, JSON.stringify(answer)).toEqual([[PAGE_BASE_DARK]]);
    }
  });

  it('takes the next page’s say, both ways, and applies only what changes', async () => {
    const { wc, apply } = follow();
    await showPage(wc, 'https://plain.example/', false);
    await showPage(wc, 'https://plain.example/other', false);
    await showPage(wc, 'https://dark.example/', true);
    expect(apply.mock.calls).toEqual([[PAGE_BASE_DARK], [PAGE_BASE_LIGHT], [PAGE_BASE_DARK]]);
  });

  it('asks again once the page has stopped loading: a page may style itself late', async () => {
    const { wc, last } = follow();
    await showPage(wc, 'https://late.example/', false);
    expect(last()).toBe(PAGE_BASE_LIGHT);
    wc.answer = () => true;
    wc.emit('did-stop-loading');
    await vi.waitFor(() => expect(last()).toBe(PAGE_BASE_DARK));
  });

  it('keeps a blank page dark, without asking it', async () => {
    const { wc, apply } = follow();
    await showPage(wc, 'https://plain.example/', false);
    wc.url = 'about:blank';
    wc.emit('did-navigate');
    wc.emit('dom-ready');
    expect(apply.mock.calls.at(-1)).toEqual([PAGE_BASE_DARK]);
    expect(wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1);
  });

  it('makes an error page dark at once, and never asks it — Chromium’s is blank', async () => {
    const { wc, last } = follow();
    await showPage(wc, 'https://plain.example/', false);
    wc.url = 'https://unreachable.example/';
    failLoad(wc, -105);
    expect(last()).toBe(PAGE_BASE_DARK);
    wc.emit('dom-ready');
    wc.emit('did-stop-loading');
    await new Promise((r) => setTimeout(r, 0));
    expect(last()).toBe(PAGE_BASE_DARK);
    expect(wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1);
    // The next page that commits has its say again.
    await showPage(wc, 'https://plain.example/', false);
    expect(last()).toBe(PAGE_BASE_LIGHT);
  });

  it('leaves the page that is there for a load called off, and for a frame’s failure', async () => {
    const { wc, last } = follow();
    await showPage(wc, 'https://plain.example/', false);
    failLoad(wc, -3);
    failLoad(wc, -105, false);
    expect(last()).toBe(PAGE_BASE_LIGHT);
  });

  it('drops an answer about a document that is gone', async () => {
    const { wc, apply } = follow();
    let answer: (own: unknown) => void = () => undefined;
    wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    wc.url = 'https://plain.example/';
    wc.emit('did-navigate');
    wc.emit('dom-ready');
    await vi.waitFor(() => expect(wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalled());
    wc.url = 'https://dark.example/';
    wc.emit('did-navigate');
    answer(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(apply.mock.calls).toEqual([[PAGE_BASE_DARK]]);
  });

  it('survives a page that is gone in the middle of it', async () => {
    const { wc, apply } = follow();
    wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => {
      throw new Error('Object has been destroyed');
    });
    wc.url = 'https://plain.example/';
    wc.emit('dom-ready');
    await new Promise((r) => setTimeout(r, 0));
    wc.destroyed = true;
    wc.emit('did-stop-loading');
    await new Promise((r) => setTimeout(r, 0));
    expect(apply.mock.calls).toEqual([[PAGE_BASE_DARK]]);
  });
});

describe('followWindowBackground', () => {
  it('sets the window’s own background, and leaves a window that is gone alone', async () => {
    const wc = new FakeContents();
    let destroyed = false;
    const win = {
      webContents: wc,
      isDestroyed: () => destroyed,
      setBackgroundColor: vi.fn(),
    };
    followWindowBackground(win as unknown as BrowserWindow);
    expect(win.setBackgroundColor).toHaveBeenCalledWith(PAGE_BASE_DARK);
    await showPage(wc, 'https://plain.example/', false);
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(PAGE_BASE_LIGHT);
    destroyed = true;
    wc.answer = () => true;
    wc.emit('did-stop-loading');
    await new Promise((r) => setTimeout(r, 0));
    expect(win.setBackgroundColor).toHaveBeenCalledTimes(2);
  });
});

describe('PAINTS_OWN_BACKGROUND, run as the page would', () => {
  type Style = { backgroundColor: string; backgroundImage: string };
  const NONE: Style = { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none' };
  /** The script against a document whose root and body have these computed styles. */
  const run = (root: Partial<Style>, body: Partial<Style> | null = {}): unknown => {
    const html = { tag: 'html' };
    const bodyEl = body ? { tag: 'body' } : null;
    const styles = new Map<object, Style>([[html, { ...NONE, ...root }]]);
    if (bodyEl && body) styles.set(bodyEl, { ...NONE, ...body });
    return runInNewContext(PAINTS_OWN_BACKGROUND, {
      document: { documentElement: html, body: bodyEl },
      getComputedStyle: (el: object) => styles.get(el),
    });
  };

  it('says no for a page whose root and body paint nothing', () => {
    expect(run({})).toBe(false);
    expect(run({}, null)).toBe(false);
    expect(
      run({ backgroundColor: 'transparent' }, { backgroundColor: 'rgba(255, 255, 255, 0)' }),
    ).toBe(false);
    expect(run({ backgroundColor: 'color(srgb 1 1 1 / 0)' })).toBe(false);
  });

  it('says yes for a colour of its own on either — black too — or an image', () => {
    expect(run({ backgroundColor: 'rgb(20, 20, 20)' })).toBe(true);
    expect(run({}, { backgroundColor: 'rgb(0, 0, 0)' })).toBe(true);
    expect(run({}, { backgroundColor: 'rgba(0, 0, 0, 0.5)' })).toBe(true);
    expect(run({ backgroundColor: 'oklch(0.2 0 0)' })).toBe(true);
    expect(run({}, { backgroundImage: 'linear-gradient(rgb(0, 0, 0), rgb(17, 17, 17))' })).toBe(
      true,
    );
  });
});
