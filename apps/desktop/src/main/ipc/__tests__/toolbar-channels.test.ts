import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS } from '@shared-ipc';
import { describe, expect, it } from 'vitest';

/**
 * The toolbar's preload spells its channels out as literals — a sandboxed preload cannot import `@shared-ipc` —
 * so nothing but this test notices when one of the two copies changes and the other does not.
 */
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const source = read('../../../preload/toolbar.ts');
/** `renderer/toolbar/bridge.ts` types `window.browserNav` by hand: the renderer build cannot see the preload. */
const bridge = read('../../../renderer/toolbar/bridge.ts');

const literals = [...source.matchAll(/^const (BROWSER_NAV_[A-Z_]+) = '([^']+)';$/gm)].map(
  ([, name, value]) => [name as string, value as string] as const,
);

/** The two-space-indented member names of the block that starts with `opening` and ends at the first `closing`. */
const membersOf = (text: string, opening: string, closing: string): string[] => {
  const start = text.indexOf(opening);
  if (start < 0) throw new Error(`no "${opening}"`);
  const end = text.indexOf(closing, start);
  return [...text.slice(start, end).matchAll(/^ {2}([a-zA-Z]+)(?:\??):/gm)]
    .map(([, name]) => name as string)
    .sort();
};

describe('the toolbar preload’s channel literals', () => {
  it('are there to check', () => {
    expect(literals.length).toBeGreaterThan(10);
  });

  for (const [name, value] of literals) {
    it(`${name} is the channel main listens on`, () => {
      expect(value).toBe((IPC_CHANNELS as Record<string, string>)[name]);
    });
  }

  it('cover every browser-nav channel main has', () => {
    const spelled = new Set(literals.map(([name]) => name));
    const missing = Object.keys(IPC_CHANNELS).filter(
      (name) => name.startsWith('BROWSER_NAV_') && !spelled.has(name),
    );
    expect(missing).toEqual([]);
  });
});

describe('the toolbar bridge', () => {
  it('types every method the preload exposes, and nothing else', () => {
    const exposed = membersOf(source, 'const browserNav = {', '} as const;');
    const typed = membersOf(bridge, 'export interface BrowserNavBridge {', '\n}');
    expect(exposed.length).toBeGreaterThan(10);
    expect(typed).toEqual(exposed);
  });
});
