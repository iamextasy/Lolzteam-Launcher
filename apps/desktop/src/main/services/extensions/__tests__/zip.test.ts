import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ExtensionError } from '../errors';
import {
  ZIP_LIMITS,
  crc32,
  eachLimited,
  extractZip,
  isZip,
  readZipDirectory,
  readZipEntry,
  safeEntryPath,
} from '../zip';
import { makeZip, crc32 as referenceCrc32 } from './helpers';

const scratch = mkdtempSync(join(tmpdir(), 'lzt-zip-'));
afterAll(() => fs.rm(scratch, { recursive: true, force: true }));

let n = 0;
const freshDir = (): string => join(scratch, `out-${++n}`);

const codeOf = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ExtensionError) return err.code;
    throw err;
  }
  throw new Error('expected a failure');
};

describe('crc32', () => {
  it('matches the bit-by-bit reference, and the well-known check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const data = Buffer.from('Lolzteam Launcher synthetic payload '.repeat(50));
    expect(crc32(data)).toBe(referenceCrc32(data));
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('isZip', () => {
  it('knows a local header and an empty archive, and nothing else', () => {
    expect(isZip(makeZip([{ name: 'a.txt', data: 'a' }]))).toBe(true);
    expect(isZip(makeZip([]))).toBe(true);
    expect(isZip(Buffer.from('Cr24'))).toBe(false);
    expect(isZip(Buffer.from('PK'))).toBe(false);
  });
});

describe('readZipDirectory + readZipEntry', () => {
  it('reads stored and deflated entries alike', async () => {
    const big = 'deflate me '.repeat(500);
    const buf = makeZip([
      { name: 'stored.txt', data: 'plain bytes', method: 0 },
      { name: 'dir/', data: '' },
      { name: 'dir/deflated.txt', data: big, method: 8 },
      { name: 'empty.txt', data: '', method: 8 },
    ]);
    const entries = readZipDirectory(buf);
    expect(entries.map((e) => [e.path, e.isDir, e.method])).toEqual([
      ['stored.txt', false, 0],
      ['dir', true, 0],
      ['dir/deflated.txt', false, 8],
      ['empty.txt', false, 8],
    ]);
    expect((await readZipEntry(buf, entries[0]!)).toString()).toBe('plain bytes');
    expect((await readZipEntry(buf, entries[2]!)).toString()).toBe(big);
    expect((await readZipEntry(buf, entries[3]!)).length).toBe(0);
  });

  it('finds the archive behind bytes glued in front of it', async () => {
    const buf = makeZip([{ name: 'a.txt', data: 'after a stub' }], {
      prefix: Buffer.from('#!/bin/sh\nexit 0\n'),
    });
    const [entry] = readZipDirectory(buf);
    expect((await readZipEntry(buf, entry!)).toString()).toBe('after a stub');
  });

  it('refuses entries whose bytes fail their checksum', async () => {
    const buf = makeZip([{ name: 'a.txt', data: 'payload', crc: 0x12345678 }]);
    const [entry] = readZipDirectory(buf);
    expect(await codeOf(() => readZipEntry(buf, entry!))).toBe('bad_package');
  });

  it('refuses a deflated entry that inflates past its declared size (a bomb or a lie)', async () => {
    const buf = makeZip([{ name: 'bomb.txt', data: 'x'.repeat(100_000), size: 10 }]);
    const [entry] = readZipDirectory(buf);
    expect(await codeOf(() => readZipEntry(buf, entry!))).toBe('bad_package');
  });

  it('refuses a stored entry whose two sizes disagree', async () => {
    const buf = makeZip([{ name: 'a.txt', data: 'abc', method: 0, size: 2 }]);
    expect(await codeOf(() => readZipDirectory(buf))).toBe('bad_package');
  });

  it('refuses ZIP64, encryption, unknown methods and garbage with clear errors', async () => {
    const zip64 = makeZip([{ name: 'a.txt', data: 'a' }], { zip64Locator: true });
    await expect(async () => readZipDirectory(zip64)).rejects.toThrow(/ZIP64/);
    const encrypted = makeZip([{ name: 'a.txt', data: 'a', flags: 1 }]);
    await expect(async () => readZipDirectory(encrypted)).rejects.toThrow(/encrypted/);
    const bzip2 = makeZip([{ name: 'a.txt', data: 'a', method: 12 }]);
    await expect(async () => readZipDirectory(bzip2)).rejects.toThrow(/compression method 12/);
    expect(await codeOf(() => readZipDirectory(Buffer.from('not an archive at all')))).toBe(
      'bad_package',
    );
    expect(await codeOf(() => readZipDirectory(Buffer.alloc(4)))).toBe('bad_package');
  });

  it('refuses a truncated archive instead of reading past the end', async () => {
    const buf = makeZip([{ name: 'a.txt', data: 'x'.repeat(1000), method: 0 }]);
    // Cut the data short but keep a valid-looking end record.
    const cut = Buffer.concat([buf.subarray(0, 40), buf.subarray(buf.length - 22 - 46 - 5)]);
    expect(await codeOf(() => readZipDirectory(cut))).toBe('bad_package');
  });

  describe('caps', () => {
    const tiny = { maxEntries: 3, maxTotalBytes: 100, maxFileBytes: 60 };

    it('on the number of entries', async () => {
      const buf = makeZip(['a', 'b', 'c', 'd'].map((name) => ({ name, data: name })));
      expect(await codeOf(() => readZipDirectory(buf, tiny))).toBe('too_large');
      expect(readZipDirectory(buf, ZIP_LIMITS)).toHaveLength(4);
    });

    it('on the size of one file', async () => {
      const buf = makeZip([{ name: 'big', data: 'x'.repeat(61) }]);
      expect(await codeOf(() => readZipDirectory(buf, tiny))).toBe('too_large');
    });

    it('on the size of everything together', async () => {
      const buf = makeZip([
        { name: 'a', data: 'x'.repeat(60) },
        { name: 'b', data: 'x'.repeat(50) },
      ]);
      expect(await codeOf(() => readZipDirectory(buf, tiny))).toBe('too_large');
    });

    it('trusts the declared size only as far as the data bears it out', async () => {
      // Declares 1 byte (under every cap), inflates to far more: refused while reading.
      const buf = makeZip([{ name: 'liar', data: 'x'.repeat(5000), size: 1 }]);
      const [entry] = readZipDirectory(buf, tiny);
      expect(await codeOf(() => readZipEntry(buf, entry!))).toBe('bad_package');
    });
  });
});

describe('safeEntryPath', () => {
  it('passes ordinary names, normalising separators', () => {
    expect(safeEntryPath('manifest.json')).toBe('manifest.json');
    expect(safeEntryPath('js/lib/a.js')).toBe('js/lib/a.js');
    expect(safeEntryPath('js\\win\\a.js')).toBe('js/win/a.js');
    expect(safeEntryPath('dir/')).toBe('dir');
    expect(safeEntryPath('a//b')).toBe('a/b');
    expect(safeEntryPath('.well-known/x')).toBe('.well-known/x');
    expect(safeEntryPath('name.with.dots.js')).toBe('name.with.dots.js');
  });

  it.each([
    '../evil.js',
    'a/../../evil.js',
    '..\\evil.js',
    'a\\..\\..\\evil.js',
    '/etc/passwd',
    '\\Windows\\evil.dll',
    '//server/share/x',
    'C:/Windows/evil.dll',
    'c:evil.dll',
    'a/file.txt:stream',
    './a.js',
    'a/.../b.js',
    'a/.. /b.js',
    'a/ ./b.js',
    'a\u0000b',
    'a/\u0001b',
    '',
    '/',
  ])('refuses %j', (name) => {
    expect(safeEntryPath(name)).toBeNull();
  });
});

describe('eachLimited', () => {
  it('runs at most `width` at a time and reaches every item', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(item);
      running -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('after a failure starts nothing new, and throws only once every lane is idle', async () => {
    let running = 0;
    const started: number[] = [];
    const items = Array.from({ length: 50 }, (_, i) => i);
    const run = eachLimited(items, 4, async (item) => {
      started.push(item);
      running += 1;
      await new Promise((r) => setTimeout(r, item === 0 ? 0 : 5));
      running -= 1;
      if (item === 0) throw new Error('bad checksum');
    });
    await expect(run).rejects.toThrow('bad checksum');
    // The caller deletes the folder next: nothing of this run may still be writing into it.
    expect(running).toBe(0);
    expect(started.length).toBeLessThan(8);
  });
});

describe('extractZip', () => {
  it('writes the tree, creating folders, and nothing else', async () => {
    const dest = freshDir();
    await extractZip(
      makeZip([
        { name: 'manifest.json', data: '{}' },
        { name: 'js/', data: '' },
        { name: 'js/deep/a.js', data: 'a' },
        { name: 'empty/', data: '' },
      ]),
      dest,
    );
    expect(await fs.readFile(join(dest, 'manifest.json'), 'utf8')).toBe('{}');
    expect(await fs.readFile(join(dest, 'js', 'deep', 'a.js'), 'utf8')).toBe('a');
    expect((await fs.stat(join(dest, 'empty'))).isDirectory()).toBe(true);
    expect((await fs.readdir(dest)).sort()).toEqual(['empty', 'js', 'manifest.json']);
  });

  it.each([
    '../escaped.txt',
    'ok/../../escaped.txt',
    '..\\escaped.txt',
    '/tmp/escaped.txt',
    'C:\\escaped.txt',
  ])('refuses the whole archive when one entry is %j, before writing anything', async (name) => {
    const dest = freshDir();
    const buf = makeZip([
      { name: 'manifest.json', data: '{}' },
      { name, data: 'gotcha' },
    ]);
    expect(await codeOf(() => extractZip(buf, dest))).toBe('bad_package');
    await expect(fs.access(join(scratch, 'escaped.txt'))).rejects.toThrow();
    await expect(fs.access(join(dest, 'manifest.json'))).rejects.toThrow();
  });
});
