import type { BrowserBookmark } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { bookmarkHost, bookmarkHue, bookmarkLabel, bookmarkLetter } from '../bookmarkFace';

const bm = (title: string, url: string): BrowserBookmark => ({ id: 'bm-1', title, url });

describe('bookmark face', () => {
  it('reads the host without www', () => {
    expect(bookmarkHost('https://www.example.test/a')).toBe('example.test');
    expect(bookmarkHost('https://shop.example.test/')).toBe('shop.example.test');
    expect(bookmarkHost('not a url')).toBe('');
  });

  it('labels by title, then host', () => {
    expect(bookmarkLabel(bm(' Market ', 'https://example.test/'))).toBe('Market');
    expect(bookmarkLabel(bm('', 'https://www.example.test/x'))).toBe('example.test');
  });

  it('letters by the site, not by the title', () => {
    expect(bookmarkLetter(bm('Market', 'https://www.example.test/'))).toBe('E');
    // `URL` spells a Cyrillic domain as `xn--…`: the title's letter reads better than an X.
    expect(bookmarkLetter(bm('Рынок', 'https://рынок.example/'))).toBe('Р');
    expect(bookmarkLetter(bm('', 'bad'))).toBe('B');
  });

  it('gives one site one colour', () => {
    const a = bookmarkHue(bm('A', 'https://example.test/one'));
    const b = bookmarkHue(bm('B', 'https://www.example.test/two'));
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });
});
