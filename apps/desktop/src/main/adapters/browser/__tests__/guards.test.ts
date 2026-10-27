import type { HandlerDetails, WebContents, WindowOpenHandlerResponse } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAIN_COLORS } from '../../../theme';

// `guards.ts` imports `shell` for the one user-initiated "open outside" path.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));

/** Synthetic ids (32 letters a–p, as Chrome spells them): one installed and enabled, one switched off. */
const ENABLED = 'abcdefghijklmnopabcdefghijklmnop';
const DISABLED = 'ponmlkjihgfedcbaponmlkjihgfedcba';

// The registry, as far as the guards ask it: which extension URLs belong to an enabled extension.
vi.mock('../../../services/extensions', () => ({
  isEnabledExtensionUrl: (url: string) => {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === 'chrome-extension:' && hostname === ENABLED;
    } catch {
      return false;
    }
  },
}));

const {
  guardLocalWebContents,
  guardWebContents,
  isAllowedPermission,
  isNavigableUrl,
  isSameFilePage,
  isWebUrl,
} = await import('../guards');
type OpenTab = import('../guards').OpenTab;

/** The two predicates behind the account browser's guards. */
describe('isWebUrl', () => {
  it('accepts http and https', () => {
    expect(isWebUrl('https://steamcommunity.com/login')).toBe(true);
    expect(isWebUrl('http://example.com')).toBe(true);
    expect(isWebUrl('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('rejects the schemes a page could redirect itself into', () => {
    // Reading the disk with the page's own scripts.
    expect(isWebUrl('file:///C:/Users/user/AppData/Roaming')).toBe(false);
    // Running in whatever document is currently loaded.
    expect(isWebUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isWebUrl('data:text/html,<script>1</script>')).toBe(false);
    // A protocol handler is an arbitrary program on the user's machine.
    expect(isWebUrl('steam://run/730')).toBe(false);
    expect(isWebUrl('ms-msdt:/id')).toBe(false);
  });

  it('rejects anything that is not a URL at all', () => {
    expect(isWebUrl('')).toBe(false);
    expect(isWebUrl('   ')).toBe(false);
    expect(isWebUrl('not a url')).toBe(false);
    // Scheme-relative: no protocol to check, so it cannot be vouched for here.
    expect(isWebUrl('//evil.example')).toBe(false);
  });
});

describe('isNavigableUrl', () => {
  it('lets the web through, exactly as isWebUrl does', () => {
    expect(isNavigableUrl('https://steamcommunity.com/tradeoffer/new/')).toBe(true);
    expect(isNavigableUrl('http://example.com')).toBe(true);
  });

  it('lets through the pages of an enabled extension', () => {
    // A popup linking to its options page; an extension opening one of its own pages.
    expect(isNavigableUrl(`chrome-extension://${ENABLED}/html/tradeoffers.html`)).toBe(true);
    expect(isNavigableUrl(`chrome-extension://${ENABLED}/dist/index.html#/settings`)).toBe(true);
  });

  it('keeps out an extension that is switched off, removed, or never was the launcher’s', () => {
    expect(isNavigableUrl(`chrome-extension://${DISABLED}/popup.html`)).toBe(false);
    expect(isNavigableUrl('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html')).toBe(
      false,
    );
  });

  it('still refuses everything else', () => {
    expect(isNavigableUrl('file:///etc/passwd')).toBe(false);
    expect(isNavigableUrl('javascript:alert(1)')).toBe(false);
    expect(isNavigableUrl('chrome://settings')).toBe(false);
    expect(isNavigableUrl('devtools://devtools/bundled/inspector.html')).toBe(false);
    expect(isNavigableUrl('steam://run/730')).toBe(false);
    expect(isNavigableUrl('')).toBe(false);
  });
});

describe('isAllowedPermission', () => {
  it('allows only what a login page legitimately needs', () => {
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true);
    expect(isAllowedPermission('fullscreen')).toBe(true);
  });

  it('denies clipboard-read even though the write is allowed', () => {
    // The asymmetry is the point: writing is the site's own data going out.
    expect(isAllowedPermission('clipboard-read')).toBe(false);
  });

  it('denies the rest', () => {
    for (const p of [
      'media',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'pointerLock',
      'openExternal',
      'display-capture',
      'idle-detection',
      'window-management',
      'unknown-future-permission',
    ]) {
      expect(isAllowedPermission(p), p).toBe(false);
    }
  });
});

const NO_REFERRER = { url: '', policy: 'default' } as const;

/** A `WebContents` as far as the guard touches it: the open handler it sets and the events it listens to. */
const fakeContents = () => {
  let handler: ((details: HandlerDetails) => WindowOpenHandlerResponse) | undefined;
  const events = new Map<string, (...args: unknown[]) => void>();
  const wc = {
    setWindowOpenHandler: (h: typeof handler) => {
      handler = h;
    },
    on: (event: string, fn: (...args: unknown[]) => void) => {
      events.set(event, fn);
    },
  } as unknown as WebContents;
  const open = (
    url: string,
    disposition: HandlerDetails['disposition'],
    extra: Partial<HandlerDetails> = {},
  ) => {
    if (!handler) throw new Error('no window-open handler');
    return handler({
      url,
      disposition,
      frameName: '',
      features: '',
      referrer: NO_REFERRER,
      ...extra,
    });
  };
  return { wc, open, events };
};

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('guardWebContents — what a page opens', () => {
  const SANDBOXED = {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
  };

  it('refuses anything off the web, tabs or no tabs', () => {
    const openTab = vi.fn<OpenTab>();
    const { wc, open } = fakeContents();
    guardWebContents(wc, log, openTab);
    for (const disposition of ['foreground-tab', 'background-tab', 'new-window'] as const) {
      expect(open('file:///etc/passwd', disposition)).toEqual({ action: 'deny' });
      expect(open('steam://run/730', disposition)).toEqual({ action: 'deny' });
    }
    expect(openTab).not.toHaveBeenCalled();
  });

  it('opens a link for a new tab as a tab of the window, around the WebContents Electron made', () => {
    const tabContents = { id: 42 } as unknown as WebContents;
    const openTab = vi.fn<OpenTab>(() => tabContents);
    const { wc, open } = fakeContents();
    guardWebContents(wc, log, openTab);

    const res = open('https://example.com/item/1', 'foreground-tab');
    expect(res.action).toBe('allow');
    expect(res.outlivesOpener).toBe(true);
    expect(res.overrideBrowserWindowOptions?.webPreferences).toEqual(SANDBOXED);
    const guest = { id: 41 } as unknown as WebContents;
    expect(res.createWindow?.({ webContents: guest } as never)).toBe(tabContents);
    expect(openTab).toHaveBeenCalledWith(guest, {
      url: 'https://example.com/item/1',
      background: false,
      opener: wc,
      referrer: NO_REFERRER,
    });
  });

  it('opens a Ctrl-clicked link as a background tab, with its referrer and POST body', () => {
    const openTab = vi.fn<OpenTab>(() => ({ id: 7 }) as unknown as WebContents);
    const { wc, open } = fakeContents();
    guardWebContents(wc, log, openTab);
    const referrer = {
      url: 'https://example.com/list',
      policy: 'strict-origin-when-cross-origin',
    } as const;
    const postBody = {
      data: [{ type: 'rawData', bytes: Buffer.from('q=1') }],
      contentType: 'application/x-www-form-urlencoded',
    } as HandlerDetails['postBody'];
    // Electron hands no WebContents over for these: `createWindow` gets none.
    open('https://example.com/', 'background-tab', { referrer, postBody }).createWindow?.(
      {} as never,
    );
    expect(openTab).toHaveBeenCalledWith(undefined, {
      url: 'https://example.com/',
      background: true,
      opener: wc,
      referrer,
      postBody,
    });
  });

  it('lets a page open the launcher’s enabled extension pages as tabs', () => {
    const openTab = vi.fn<OpenTab>();
    const { wc, open } = fakeContents();
    guardWebContents(wc, log, openTab);
    expect(open(`chrome-extension://${ENABLED}/options.html`, 'foreground-tab').action).toBe(
      'allow',
    );
    expect(open(`chrome-extension://${DISABLED}/options.html`, 'foreground-tab')).toEqual({
      action: 'deny',
    });
  });

  it('keeps a popup with window features a window of its own, sandboxed', () => {
    const openTab = vi.fn<OpenTab>();
    const { wc, open } = fakeContents();
    guardWebContents(wc, log, openTab);
    const res = open('https://steamcommunity.com/tradeoffer/new/', 'new-window');
    expect(res.action).toBe('allow');
    expect(res.createWindow).toBeUndefined();
    expect(res.outlivesOpener).toBeUndefined();
    expect(res.overrideBrowserWindowOptions?.webPreferences).toEqual(SANDBOXED);
    // Dark until its page paints: no white flash.
    expect(res.overrideBrowserWindowOptions?.backgroundColor).toBe(MAIN_COLORS.bg);
    expect(openTab).not.toHaveBeenCalled();
  });

  it('opens everything as a window where there are no tabs (an extension’s background page)', () => {
    const { wc, open } = fakeContents();
    guardWebContents(wc, log);
    for (const disposition of ['foreground-tab', 'background-tab', 'new-window'] as const) {
      const res = open('https://example.com/', disposition);
      expect(res.action).toBe('allow');
      expect(res.createWindow).toBeUndefined();
      expect(res.overrideBrowserWindowOptions?.webPreferences).toEqual(SANDBOXED);
      expect(res.overrideBrowserWindowOptions?.backgroundColor).toBe(MAIN_COLORS.bg);
    }
  });

  it('hands the tabs down to the popups it lets open', () => {
    const openTab = vi.fn<OpenTab>(() => ({ id: 9 }) as unknown as WebContents);
    const parent = fakeContents();
    guardWebContents(parent.wc, log, openTab);
    const child = fakeContents();
    const popup = {
      setMenu: vi.fn(),
      setBackgroundColor: vi.fn(),
      isDestroyed: () => false,
      webContents: child.wc,
    };
    parent.events.get('did-create-window')?.(popup);
    expect(popup.setMenu).toHaveBeenCalledWith(null);
    // Dark until its page has a say, as a tab is.
    expect(popup.setBackgroundColor).toHaveBeenCalledWith(MAIN_COLORS.bg);
    expect(child.events.has('dom-ready')).toBe(true);
    child.open('https://example.com/from-popup', 'foreground-tab').createWindow?.({} as never);
    expect(openTab).toHaveBeenCalledWith(undefined, {
      url: 'https://example.com/from-popup',
      background: false,
      opener: child.wc,
      referrer: NO_REFERRER,
    });
  });
});

describe('isSameFilePage', () => {
  const PAGE =
    'file:///opt/app/resources/app.asar/out/renderer/toolbar/index.html?lang=ru&os=linux';

  it('is the same file, whatever its query or fragment', () => {
    expect(isSameFilePage(PAGE, PAGE)).toBe(true);
    expect(
      isSameFilePage('file:///opt/app/resources/app.asar/out/renderer/toolbar/index.html#x', PAGE),
    ).toBe(true);
    const win =
      'file:///C:/Users/user/AppData/Local/Programs/app/resources/app.asar/out/index.html';
    expect(isSameFilePage(`${win}?lang=en`, win)).toBe(true);
  });

  it('is no other file, and nothing off the disk', () => {
    expect(isSameFilePage('file:///home/user/Downloads/page.html', PAGE)).toBe(false);
    expect(
      isSameFilePage('file:///opt/app/resources/app.asar/out/renderer/toolbar/other.html', PAGE),
    ).toBe(false);
    expect(isSameFilePage('https://example.com/', PAGE)).toBe(false);
    expect(isSameFilePage(PAGE, 'https://example.com/')).toBe(false);
    expect(isSameFilePage('not a url', PAGE)).toBe(false);
  });
});

describe('guardLocalWebContents — the toolbar', () => {
  const PAGE =
    'file:///opt/app/resources/app.asar/out/renderer/toolbar/index.html?lang=ru&os=linux';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The toolbar's page, as far as the guard asks it; `navigate` says whether the guard let it go. */
  const toolbar = () => {
    const { wc, open, events } = fakeContents();
    (wc as unknown as { getURL: () => string }).getURL = () => PAGE;
    guardLocalWebContents(wc, log);
    const navigate = (url: string): boolean => {
      const preventDefault = vi.fn();
      events.get('will-navigate')?.({ preventDefault }, url);
      return preventDefault.mock.calls.length === 0;
    };
    return { open, navigate };
  };

  it('reloads its own page', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const { navigate } = toolbar();
    expect(navigate(PAGE)).toBe(true);
    expect(
      navigate('file:///opt/app/resources/app.asar/out/renderer/toolbar/index.html?lang=en'),
    ).toBe(true);
  });

  it('never opens a file dropped onto it, nor goes anywhere else', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const { navigate } = toolbar();
    expect(navigate('file:///home/user/Downloads/page.html')).toBe(false);
    expect(navigate('file:///opt/app/resources/app.asar/out/renderer/index.html')).toBe(false);
    expect(navigate('https://example.com/')).toBe(false);
  });

  it('follows the dev server’s reloads', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    const { navigate } = toolbar();
    expect(navigate('http://localhost:5173/toolbar/index.html?lang=ru')).toBe(true);
    expect(navigate('file:///home/user/Downloads/page.html')).toBe(false);
  });

  it('opens no window', () => {
    const { open } = toolbar();
    expect(open('https://example.com/', 'foreground-tab')).toEqual({ action: 'deny' });
  });
});
