import { describe, expect, it } from 'vitest';
import { type ShortcutInput, matchShortcut, yieldsToTextField } from '../shortcuts';

/** A key-down with no modifiers; `code` follows `key` for Latin letters and digits unless given. */
const key = (k: string, mods: Partial<ShortcutInput> = {}): ShortcutInput => ({
  type: 'keyDown',
  key: k,
  code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods,
});
const ctrl = (k: string, mods: Partial<ShortcutInput> = {}) => key(k, { control: true, ...mods });
const cmd = (k: string, mods: Partial<ShortcutInput> = {}) => key(k, { meta: true, ...mods });

const PC: readonly NodeJS.Platform[] = ['win32', 'linux'];

describe('matchShortcut — Windows and Linux', () => {
  for (const platform of PC) {
    describe(platform, () => {
      it('reloads on Ctrl+R and F5', () => {
        expect(matchShortcut(ctrl('r'), platform)).toEqual({ kind: 'reload' });
        expect(matchShortcut(key('F5'), platform)).toEqual({ kind: 'reload' });
      });

      it('skips the cache on Ctrl+Shift+R, Shift+F5 and Ctrl+F5', () => {
        expect(matchShortcut(ctrl('R', { shift: true }), platform)).toEqual({ kind: 'hardReload' });
        expect(matchShortcut(key('F5', { shift: true }), platform)).toEqual({ kind: 'hardReload' });
        expect(matchShortcut(ctrl('F5'), platform)).toEqual({ kind: 'hardReload' });
      });

      it('goes back and forward on Alt+←/→', () => {
        expect(matchShortcut(key('ArrowLeft', { alt: true }), platform)).toEqual({ kind: 'back' });
        expect(matchShortcut(key('ArrowRight', { alt: true }), platform)).toEqual({
          kind: 'forward',
        });
      });

      it('leaves the macOS chords alone', () => {
        expect(matchShortcut(ctrl('ArrowLeft'), platform)).toBeNull(); // a word left
        expect(matchShortcut(ctrl('[', { code: 'BracketLeft' }), platform)).toBeNull();
        expect(matchShortcut(key('ArrowLeft', { alt: true, shift: true }), platform)).toBeNull();
      });

      it('focuses the address bar on Ctrl+L and F6', () => {
        expect(matchShortcut(ctrl('l'), platform)).toEqual({ kind: 'focusAddress' });
        expect(matchShortcut(key('F6'), platform)).toEqual({ kind: 'focusAddress' });
        expect(matchShortcut(key('F6', { shift: true }), platform)).toBeNull();
      });

      it('stops on a bare Esc only', () => {
        expect(matchShortcut(key('Escape'), platform)).toEqual({ kind: 'stop' });
        expect(matchShortcut(key('Escape', { shift: true }), platform)).toBeNull();
        expect(matchShortcut(ctrl('Escape'), platform)).toBeNull();
      });

      it('bookmarks the page on Ctrl+D', () => {
        expect(matchShortcut(ctrl('d'), platform)).toEqual({ kind: 'addBookmark' });
        expect(matchShortcut(ctrl('D', { shift: true }), platform)).toBeNull();
      });

      it('opens bookmark N on Ctrl+N, from the digit row and the numpad', () => {
        expect(matchShortcut(ctrl('1'), platform)).toEqual({ kind: 'openBookmark', index: 0 });
        expect(matchShortcut(ctrl('9'), platform)).toEqual({ kind: 'openBookmark', index: 8 });
        expect(matchShortcut(ctrl('5', { code: 'Numpad5' }), platform)).toEqual({
          kind: 'openBookmark',
          index: 4,
        });
        expect(matchShortcut(ctrl('0'), platform)).toBeNull();
        expect(matchShortcut(ctrl('1', { shift: true }), platform)).toBeNull();
      });

      it('ignores the Windows key, which is not the shortcut key here', () => {
        expect(matchShortcut(key('r', { meta: true }), platform)).toBeNull();
        expect(matchShortcut(ctrl('r', { meta: true }), platform)).toBeNull();
        expect(matchShortcut(key('F5', { meta: true }), platform)).toBeNull();
        expect(matchShortcut(ctrl('Tab', { meta: true }), platform)).toBeNull();
        expect(matchShortcut(key('t', { meta: true }), platform)).toBeNull();
      });

      it('opens a tab on Ctrl+T and brings the last closed one back on Ctrl+Shift+T', () => {
        expect(matchShortcut(ctrl('t'), platform)).toEqual({ kind: 'newTab' });
        expect(matchShortcut(ctrl('T', { shift: true }), platform)).toEqual({ kind: 'reopenTab' });
      });

      it('closes the tab on Ctrl+W and Ctrl+F4, and leaves Alt+F4 to the system', () => {
        expect(matchShortcut(ctrl('w'), platform)).toEqual({ kind: 'closeTab' });
        expect(matchShortcut(ctrl('F4'), platform)).toEqual({ kind: 'closeTab' });
        expect(matchShortcut(ctrl('W', { shift: true }), platform)).toBeNull();
        expect(matchShortcut(key('F4'), platform)).toBeNull();
        expect(matchShortcut(key('F4', { alt: true }), platform)).toBeNull();
        expect(matchShortcut(ctrl('F4', { shift: true }), platform)).toBeNull();
      });

      it('switches tabs on Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp', () => {
        expect(matchShortcut(ctrl('Tab'), platform)).toEqual({ kind: 'nextTab' });
        expect(matchShortcut(ctrl('Tab', { shift: true }), platform)).toEqual({ kind: 'prevTab' });
        expect(matchShortcut(ctrl('PageDown'), platform)).toEqual({ kind: 'nextTab' });
        expect(matchShortcut(ctrl('PageUp'), platform)).toEqual({ kind: 'prevTab' });
        // Chrome moves the tab on these; here they are the page's.
        expect(matchShortcut(ctrl('PageDown', { shift: true }), platform)).toBeNull();
        expect(matchShortcut(ctrl('PageUp', { shift: true }), platform)).toBeNull();
        expect(matchShortcut(key('Tab'), platform)).toBeNull();
        expect(matchShortcut(key('PageDown'), platform)).toBeNull();
      });

      it('keeps Ctrl+1…9 on the bookmarks, not the tabs', () => {
        expect(matchShortcut(ctrl('1'), platform)).toEqual({ kind: 'openBookmark', index: 0 });
        expect(matchShortcut(ctrl('8'), platform)).toEqual({ kind: 'openBookmark', index: 7 });
      });

      it('leaves the macOS tab chords alone', () => {
        expect(matchShortcut(ctrl('ArrowRight', { alt: true }), platform)).toBeNull();
        expect(
          matchShortcut(ctrl('}', { code: 'BracketRight', shift: true }), platform),
        ).toBeNull();
      });
    });
  }

  it('reads the tab letters by position on a non-Latin layout', () => {
    // Russian layout: the T key types «е», the W key «ц».
    expect(matchShortcut(ctrl('е', { code: 'KeyT' }), 'win32')).toEqual({ kind: 'newTab' });
    expect(matchShortcut(ctrl('Е', { code: 'KeyT', shift: true }), 'win32')).toEqual({
      kind: 'reopenTab',
    });
    expect(matchShortcut(ctrl('ц', { code: 'KeyW' }), 'linux')).toEqual({ kind: 'closeTab' });
  });

  it('reads the physical key when the layout is not Latin', () => {
    // Russian layout: the R key types «к», the L key «д», the D key «в».
    expect(matchShortcut(ctrl('к', { code: 'KeyR' }), 'win32')).toEqual({ kind: 'reload' });
    expect(matchShortcut(ctrl('К', { code: 'KeyR', shift: true }), 'win32')).toEqual({
      kind: 'hardReload',
    });
    expect(matchShortcut(ctrl('д', { code: 'KeyL' }), 'win32')).toEqual({ kind: 'focusAddress' });
    expect(matchShortcut(ctrl('в', { code: 'KeyD' }), 'win32')).toEqual({ kind: 'addBookmark' });
  });

  it('reads the typed letter on a Latin layout that moves it (Dvorak)', () => {
    // Dvorak's R sits on QWERTY's O.
    expect(matchShortcut(ctrl('r', { code: 'KeyO' }), 'win32')).toEqual({ kind: 'reload' });
    expect(matchShortcut(ctrl('o', { code: 'KeyR' }), 'win32')).toBeNull();
  });

  it('takes the digit row by position (AZERTY types «&» on the 1 key)', () => {
    expect(matchShortcut(ctrl('&', { code: 'Digit1' }), 'win32')).toEqual({
      kind: 'openBookmark',
      index: 0,
    });
  });

  it('lets AltGr type: Ctrl+Alt is never a shortcut', () => {
    // Polish ł is AltGr+L, which Windows reports as Ctrl+Alt+L.
    expect(matchShortcut(ctrl('ł', { code: 'KeyL', alt: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('r', { alt: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('1', { alt: true }), 'win32')).toBeNull();
    // Polish ę is AltGr+E, ś AltGr+S; AltGr+T and AltGr+W type letters on other layouts.
    expect(matchShortcut(ctrl('t', { alt: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('w', { alt: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('Tab', { alt: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('PageDown', { alt: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('F4', { alt: true }), 'win32')).toBeNull();
  });

  it('ignores plain typing', () => {
    expect(matchShortcut(key('r'), 'win32')).toBeNull();
    expect(matchShortcut(key('1'), 'win32')).toBeNull();
    expect(matchShortcut(key('ArrowLeft'), 'win32')).toBeNull();
    expect(matchShortcut(key('Enter'), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('c'), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('v'), 'win32')).toBeNull();
  });
});

describe('matchShortcut — macOS', () => {
  it('uses Cmd, not Ctrl', () => {
    expect(matchShortcut(cmd('r'), 'darwin')).toEqual({ kind: 'reload' });
    expect(matchShortcut(cmd('r', { shift: true }), 'darwin')).toEqual({ kind: 'hardReload' });
    expect(matchShortcut(cmd('l'), 'darwin')).toEqual({ kind: 'focusAddress' });
    expect(matchShortcut(cmd('d'), 'darwin')).toEqual({ kind: 'addBookmark' });
    expect(matchShortcut(cmd('3'), 'darwin')).toEqual({ kind: 'openBookmark', index: 2 });
    expect(matchShortcut(ctrl('r'), 'darwin')).toBeNull();
    expect(matchShortcut(ctrl('d'), 'darwin')).toBeNull();
    expect(matchShortcut(cmd('r', { control: true }), 'darwin')).toBeNull();
  });

  it('goes back and forward on Cmd+[ and Cmd+], whatever the layout', () => {
    expect(matchShortcut(cmd('[', { code: 'BracketLeft' }), 'darwin')).toEqual({ kind: 'back' });
    expect(matchShortcut(cmd(']', { code: 'BracketRight' }), 'darwin')).toEqual({
      kind: 'forward',
    });
    // Russian layout: the [ key types «х».
    expect(matchShortcut(cmd('х', { code: 'BracketLeft' }), 'darwin')).toEqual({ kind: 'back' });
  });

  it('marks Cmd+←/→ as caret chords', () => {
    expect(matchShortcut(cmd('ArrowLeft'), 'darwin')).toEqual({ kind: 'back', caret: true });
    expect(matchShortcut(cmd('ArrowRight'), 'darwin')).toEqual({ kind: 'forward', caret: true });
    // With Shift that is «select to the start of the line».
    expect(matchShortcut(cmd('ArrowLeft', { shift: true }), 'darwin')).toBeNull();
  });

  it('leaves Option+←/→ to the text fields (one word left/right)', () => {
    expect(matchShortcut(key('ArrowLeft', { alt: true }), 'darwin')).toBeNull();
    expect(matchShortcut(key('ArrowRight', { alt: true }), 'darwin')).toBeNull();
  });

  it('opens, closes and reopens tabs with Cmd', () => {
    expect(matchShortcut(cmd('t'), 'darwin')).toEqual({ kind: 'newTab' });
    expect(matchShortcut(cmd('T', { shift: true }), 'darwin')).toEqual({ kind: 'reopenTab' });
    expect(matchShortcut(cmd('w'), 'darwin')).toEqual({ kind: 'closeTab' });
    expect(matchShortcut(ctrl('t'), 'darwin')).toBeNull();
    expect(matchShortcut(ctrl('w'), 'darwin')).toBeNull();
    // Ctrl+F4 is not a macOS chord, and Cmd+F4 is nothing.
    expect(matchShortcut(ctrl('F4'), 'darwin')).toBeNull();
    expect(matchShortcut(cmd('F4'), 'darwin')).toBeNull();
  });

  it('switches tabs on Cmd+Shift+] / Cmd+Shift+[, whatever the layout', () => {
    expect(matchShortcut(cmd('}', { code: 'BracketRight', shift: true }), 'darwin')).toEqual({
      kind: 'nextTab',
    });
    expect(matchShortcut(cmd('{', { code: 'BracketLeft', shift: true }), 'darwin')).toEqual({
      kind: 'prevTab',
    });
    // Russian layout: Shift and the [ key type «Х».
    expect(matchShortcut(cmd('Х', { code: 'BracketLeft', shift: true }), 'darwin')).toEqual({
      kind: 'prevTab',
    });
  });

  it('switches tabs on Cmd+Option+→ / ←', () => {
    expect(matchShortcut(cmd('ArrowRight', { alt: true }), 'darwin')).toEqual({ kind: 'nextTab' });
    expect(matchShortcut(cmd('ArrowLeft', { alt: true }), 'darwin')).toEqual({ kind: 'prevTab' });
    expect(matchShortcut(cmd('ArrowLeft', { alt: true, shift: true }), 'darwin')).toBeNull();
  });

  it('switches tabs on Ctrl+Tab and Ctrl+PageDown / PageUp, with the Control key as in Chrome', () => {
    expect(matchShortcut(ctrl('Tab'), 'darwin')).toEqual({ kind: 'nextTab' });
    expect(matchShortcut(ctrl('Tab', { shift: true }), 'darwin')).toEqual({ kind: 'prevTab' });
    expect(matchShortcut(ctrl('PageDown'), 'darwin')).toEqual({ kind: 'nextTab' });
    expect(matchShortcut(ctrl('PageUp'), 'darwin')).toEqual({ kind: 'prevTab' });
    // Cmd+Tab is the system's application switcher; it never reaches a page, and is no chord here.
    expect(matchShortcut(cmd('Tab'), 'darwin')).toBeNull();
    expect(matchShortcut(ctrl('Tab', { meta: true }), 'darwin')).toBeNull();
    expect(matchShortcut(ctrl('Tab', { alt: true }), 'darwin')).toBeNull();
  });

  it('keeps Cmd+1…9 on the bookmarks', () => {
    expect(matchShortcut(cmd('1'), 'darwin')).toEqual({ kind: 'openBookmark', index: 0 });
    expect(matchShortcut(cmd('9'), 'darwin')).toEqual({ kind: 'openBookmark', index: 8 });
  });

  it('keeps F5, F6 and Esc', () => {
    expect(matchShortcut(key('F5'), 'darwin')).toEqual({ kind: 'reload' });
    expect(matchShortcut(cmd('F5'), 'darwin')).toEqual({ kind: 'hardReload' });
    expect(matchShortcut(key('F6'), 'darwin')).toEqual({ kind: 'focusAddress' });
    expect(matchShortcut(key('Escape'), 'darwin')).toEqual({ kind: 'stop' });
  });
});

describe('matchShortcut — event kinds', () => {
  it('acts on key-down only', () => {
    expect(matchShortcut(ctrl('r', { type: 'keyUp' }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('r', { type: 'char' }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('r', { type: 'rawKeyDown' }), 'win32')).toEqual({ kind: 'reload' });
  });

  it('stays out of an IME composition', () => {
    expect(matchShortcut(key('Escape', { isComposing: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('r', { isComposing: true }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('Tab', { isComposing: true }), 'win32')).toBeNull();
  });

  it('switches tabs on key-down only', () => {
    expect(matchShortcut(ctrl('Tab', { type: 'keyUp' }), 'win32')).toBeNull();
    expect(matchShortcut(ctrl('t', { type: 'keyUp' }), 'darwin')).toBeNull();
  });
});

describe('yieldsToTextField', () => {
  it('leaves Esc and the caret chords to a focused text field', () => {
    expect(yieldsToTextField({ kind: 'stop' })).toBe(true);
    expect(yieldsToTextField({ kind: 'back', caret: true })).toBe(true);
    expect(yieldsToTextField({ kind: 'forward', caret: true })).toBe(true);
  });

  it('keeps every other shortcut working from the address bar', () => {
    expect(yieldsToTextField({ kind: 'reload' })).toBe(false);
    expect(yieldsToTextField({ kind: 'hardReload' })).toBe(false);
    expect(yieldsToTextField({ kind: 'back' })).toBe(false);
    expect(yieldsToTextField({ kind: 'forward' })).toBe(false);
    expect(yieldsToTextField({ kind: 'focusAddress' })).toBe(false);
    expect(yieldsToTextField({ kind: 'addBookmark' })).toBe(false);
    expect(yieldsToTextField({ kind: 'openBookmark', index: 0 })).toBe(false);
  });

  it('keeps the tab chords working from the address bar', () => {
    for (const kind of ['newTab', 'closeTab', 'nextTab', 'prevTab', 'reopenTab'] as const) {
      expect(yieldsToTextField({ kind }), kind).toBe(false);
    }
  });
});
