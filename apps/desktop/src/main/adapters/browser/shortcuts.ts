/**
 * Keyboard shortcuts of the account browser windows.
 *
 * Those windows have no menu (`setMenu(null)`), so there are no accelerators: every chord is
 * read off `before-input-event` of the site and of the toolbar and matched here. Pure, so the
 * whole table is testable without Electron.
 */

/** What a key chord in a browser window asks for. */
export type ShortcutAction =
  | { readonly kind: 'reload' }
  | { readonly kind: 'hardReload' }
  /** `caret`: the same chord moves the caret in a text field (macOS ⌘←/⌘→). */
  | { readonly kind: 'back'; readonly caret?: true }
  | { readonly kind: 'forward'; readonly caret?: true }
  | { readonly kind: 'focusAddress' }
  /** Only means anything while the page is loading; otherwise the page keeps its Esc. */
  | { readonly kind: 'stop' }
  | { readonly kind: 'addBookmark' }
  /** 0-based: Ctrl+1 is the first bookmark of the bar — not the first tab, as it would be in Chrome. */
  | { readonly kind: 'openBookmark'; readonly index: number }
  | { readonly kind: 'newTab' }
  | { readonly kind: 'closeTab' }
  /** Round the ends: the next tab after the last one is the first. */
  | { readonly kind: 'nextTab' }
  | { readonly kind: 'prevTab' }
  /** The tab closed last in this window, back. */
  | { readonly kind: 'reopenTab' };

/** The part of Electron's `Input` the matcher reads. */
export interface ShortcutInput {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isComposing?: boolean;
}

/**
 * The letter of a chord. `key` first, so Dvorak's R is R wherever it sits; the physical key
 * when `key` is not a Latin letter, so Ctrl+R still reloads on the Russian layout (`key` = «к»).
 */
const letterOf = (input: ShortcutInput): string | null => {
  if (/^[a-z]$/i.test(input.key)) return input.key.toLowerCase();
  const physical = /^Key([A-Z])$/.exec(input.code);
  return physical?.[1] ? physical[1].toLowerCase() : null;
};

/** 1–9 from the digit row or the numpad. The physical key first: AZERTY's unshifted 1 is «&». */
const digitOf = (input: ShortcutInput): number | null => {
  const hit = /^(?:Digit|Numpad)([1-9])$/.exec(input.code) ?? /^([1-9])$/.exec(input.key);
  return hit?.[1] ? Number(hit[1]) : null;
};

const isKeyDown = (type: string): boolean => type === 'keyDown' || type === 'rawKeyDown';

export const matchShortcut = (
  input: ShortcutInput,
  platform: NodeJS.Platform,
): ShortcutAction | null => {
  if (!isKeyDown(input.type) || input.isComposing) return null;
  const { alt, shift } = input;

  // Ctrl+Tab and Ctrl+PageDown/PageUp are the Control key on every platform, macOS included — as in Chrome.
  if (input.control && !input.meta && !alt) {
    if (input.key === 'Tab') return shift ? { kind: 'prevTab' } : { kind: 'nextTab' };
    if (input.key === 'PageDown' && !shift) return { kind: 'nextTab' };
    if (input.key === 'PageUp' && !shift) return { kind: 'prevTab' };
  }

  const mac = platform === 'darwin';
  // Cmd is the shortcut key on macOS and Ctrl everywhere else; the other one held means another chord.
  const primary = mac ? input.meta : input.control;
  const foreign = mac ? input.control : input.meta;
  if (foreign) return null;

  switch (input.key) {
    case 'F5':
      if (alt) return null;
      // Shift+F5 and Ctrl+F5 both skip the cache, as in Chrome.
      return primary || shift ? { kind: 'hardReload' } : { kind: 'reload' };
    case 'F6':
      return primary || alt || shift ? null : { kind: 'focusAddress' };
    case 'Escape':
      return primary || alt || shift ? null : { kind: 'stop' };
    case 'F4':
      // Windows' and Linux's «close the document»; Alt+F4, the window, stays the system's.
      return !mac && primary && !alt && !shift ? { kind: 'closeTab' } : null;
  }

  if (mac) {
    // The bracket keys by position too: on the Russian layout they type «х» and «ъ», with Shift «Х» and «Ъ».
    const bracket =
      input.code === 'BracketLeft' || input.key === '[' || input.key === '{'
        ? 'left'
        : input.code === 'BracketRight' || input.key === ']' || input.key === '}'
          ? 'right'
          : null;
    if (primary && !alt && !shift) {
      if (bracket === 'left') return { kind: 'back' };
      if (bracket === 'right') return { kind: 'forward' };
      if (input.key === 'ArrowLeft') return { kind: 'back', caret: true };
      if (input.key === 'ArrowRight') return { kind: 'forward', caret: true };
    }
    if (primary && !alt && shift) {
      if (bracket === 'left') return { kind: 'prevTab' };
      if (bracket === 'right') return { kind: 'nextTab' };
    }
    if (primary && alt && !shift) {
      if (input.key === 'ArrowLeft') return { kind: 'prevTab' };
      if (input.key === 'ArrowRight') return { kind: 'nextTab' };
    }
    // No Option+←/→: on macOS that is «one word left/right» in every text field.
  } else if (alt && !primary && !shift) {
    if (input.key === 'ArrowLeft') return { kind: 'back' };
    if (input.key === 'ArrowRight') return { kind: 'forward' };
  }

  // AltGr is Ctrl+Alt on Windows, and it types letters (Polish ł is AltGr+L): nothing below takes Alt.
  if (!primary || alt) return null;

  switch (letterOf(input)) {
    case 'r':
      return shift ? { kind: 'hardReload' } : { kind: 'reload' };
    case 'l':
      return shift ? null : { kind: 'focusAddress' };
    case 'd':
      return shift ? null : { kind: 'addBookmark' };
    case 't':
      return shift ? { kind: 'reopenTab' } : { kind: 'newTab' };
    case 'w':
      // Ctrl+Shift+W closes the whole window in Chrome; here that is the window's own close button.
      return shift ? null : { kind: 'closeTab' };
  }

  const digit = shift ? null : digitOf(input);
  return digit === null ? null : { kind: 'openBookmark', index: digit - 1 };
};

/**
 * Chords a focused text field has its own use for: Esc (the address bar drops the edit) and
 * macOS ⌘←/⌘→ (start/end of the line). In the toolbar, where the text field is the address
 * bar, these are left to it; everything else — Ctrl+L, Ctrl+R, Ctrl+1…9, the tab chords — still works there.
 */
export const yieldsToTextField = (action: ShortcutAction): boolean =>
  action.kind === 'stop' ||
  ((action.kind === 'back' || action.kind === 'forward') && action.caret === true);
