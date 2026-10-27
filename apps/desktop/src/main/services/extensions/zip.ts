import { promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { fail } from './errors';

/** What one archive may unpack to. A store package is ~1.5k files and ~150 MB; these leave room and stop a bomb. */
export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
  readonly maxFileBytes: number;
}

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxTotalBytes: 1024 ** 3,
  maxFileBytes: 256 * 1024 ** 2,
};

export interface ZipEntry {
  /** `/`-separated and already checked to stay inside whatever folder it is unpacked into. */
  readonly path: string;
  readonly isDir: boolean;
  /** Uncompressed size, as the central directory declares it — and as the data must turn out. */
  readonly size: number;
  readonly method: 0 | 8;
  readonly crc: number;
  /** Where the (compressed) bytes sit in the archive buffer. */
  readonly dataStart: number;
  readonly dataLength: number;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_LEN = 22;
const CENTRAL_LEN = 46;
const LOCAL_LEN = 30;

const inflateRaw = promisify(zlib.inflateRaw);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const jsCrc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Node's own is native (20.15+, which every supported Electron has); the table is for anything older. */
export const crc32 = (data: Uint8Array): number =>
  typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : jsCrc32(data);

/** `PK\3\4`, or `PK\5\6` for an archive with nothing in it. */
export const isZip = (buf: Buffer): boolean =>
  buf.length >= 4 &&
  buf[0] === 0x50 &&
  buf[1] === 0x4b &&
  ((buf[2] === 3 && buf[3] === 4) || (buf[2] === 5 && buf[3] === 6));

function corrupt(why: string): never {
  fail('bad_package', `broken archive: ${why}`);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what a file name must not hold
const BAD_SEGMENT_CHARS = /[\x00-\x1f:]/;

/**
 * The entry name as a path that cannot leave the folder it is unpacked into, or `null` when it tries to.
 * Backslashes count as separators (old Windows zippers write them), so `..\` is caught like `../`;
 * a colon is refused outright, which covers drive letters and NTFS streams; and a segment of only dots
 * and spaces is refused because Windows trims those to `..` or nothing.
 */
export const safeEntryPath = (raw: string): string | null => {
  const name = raw.replace(/\\/g, '/');
  if (name.startsWith('/')) return null;
  const parts: string[] = [];
  for (const part of name.split('/')) {
    if (part === '') continue;
    if (BAD_SEGMENT_CHARS.test(part)) return null;
    if (part.replace(/[. ]+$/, '') === '') return null;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
};

const findEocd = (buf: Buffer): number => {
  const floor = Math.max(0, buf.length - EOCD_LEN - 0xffff);
  for (let i = buf.length - EOCD_LEN; i >= floor; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    if (i + EOCD_LEN + buf.readUInt16LE(i + 20) <= buf.length) return i;
  }
  return -1;
};

/** Reads the central directory and checks every entry — names, sizes, local headers — before a byte is unpacked. */
export const readZipDirectory = (buf: Buffer, limits: ZipLimits = ZIP_LIMITS): ZipEntry[] => {
  if (buf.length < EOCD_LEN) corrupt('too short');
  const eocd = findEocd(buf);
  if (eocd < 0) corrupt('no end-of-directory record');

  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const zip64Locator = eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG;
  if (zip64Locator || total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    fail('bad_package', 'ZIP64 archives are not supported');
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) {
    fail('bad_package', 'split archives are not supported');
  }
  if (total > limits.maxEntries) fail('too_large', `${total} entries in the archive`);

  // Anything glued in front of the archive (a self-extractor stub) shifts every offset by the same amount.
  const shift = eocd - (cdOffset + cdSize);
  if (shift < 0) corrupt('central directory overlaps its end record');

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let p = cdOffset + shift;
  for (let n = 0; n < total; n++) {
    if (p + CENTRAL_LEN > eocd || buf.readUInt32LE(p) !== CENTRAL_SIG) corrupt('bad central entry');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + CENTRAL_LEN + nameLen > eocd) corrupt('entry name runs past the directory');
    const rawName = buf.toString('utf8', p + CENTRAL_LEN, p + CENTRAL_LEN + nameLen);
    p += CENTRAL_LEN + nameLen + extraLen + commentLen;

    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      fail('bad_package', 'ZIP64 archives are not supported');
    }
    // Bit 0 is classic encryption, bit 6 the "strong" kind.
    if (flags & 0x41) fail('bad_package', 'encrypted archives are not supported');

    const path = safeEntryPath(rawName);
    if (path === null)
      fail('bad_package', `unsafe path in the archive: ${JSON.stringify(rawName)}`);
    const isDir = rawName.endsWith('/') || rawName.endsWith('\\');
    if (isDir) {
      entries.push({ path, isDir, size: 0, method: 0, crc: 0, dataStart: 0, dataLength: 0 });
      continue;
    }

    if (method !== 0 && method !== 8)
      fail('bad_package', `compression method ${method} in ${path}`);
    if (method === 0 && compressed !== size) corrupt(`stored ${path} has two sizes`);
    if (size > limits.maxFileBytes) fail('too_large', `${path} unpacks to ${size} bytes`);
    totalBytes += size;
    if (totalBytes > limits.maxTotalBytes)
      fail('too_large', `the archive unpacks to over ${limits.maxTotalBytes} bytes`);

    const local = localOffset + shift;
    if (local + LOCAL_LEN > buf.length || buf.readUInt32LE(local) !== LOCAL_SIG) {
      corrupt(`no local header for ${path}`);
    }
    // The local copy of the name and extra field may differ in length from the central one.
    const dataStart =
      local + LOCAL_LEN + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + compressed > buf.length) corrupt(`${path} runs past the end`);

    entries.push({
      path,
      isDir: false,
      size,
      method: method as 0 | 8,
      crc,
      dataStart,
      dataLength: compressed,
    });
  }
  return entries;
};

/** One entry's bytes, inflated and checked against the size and CRC the directory promised. */
export const readZipEntry = async (buf: Buffer, entry: ZipEntry): Promise<Buffer> => {
  const raw = buf.subarray(entry.dataStart, entry.dataStart + entry.dataLength);
  let data: Buffer;
  if (entry.method === 0) {
    data = raw;
  } else {
    try {
      // A stream that inflates past its declared size is a bomb or a lie; zlib stops it right there.
      data = await inflateRaw(raw, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      return corrupt(`cannot inflate ${entry.path}`);
    }
  }
  if (data.length !== entry.size) corrupt(`${entry.path} is not the size it claims`);
  if (crc32(data) !== entry.crc) corrupt(`${entry.path} fails its checksum`);
  return data;
};

/**
 * Runs `fn` over `items`, at most `width` at a time. After a failure no lane takes another item, and the first error
 * is thrown only once every lane is idle: the caller then deletes the folder, and nothing may still be writing to it.
 */
export const eachLimited = async <T>(
  items: readonly T[],
  width: number,
  fn: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const errors: unknown[] = [];
  const lane = async (): Promise<void> => {
    while (errors.length === 0 && next < items.length) {
      try {
        await fn(items[next++]!);
      } catch (err) {
        errors.push(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  if (errors.length > 0) throw errors[0];
};

/** Unpacks the whole archive into `dest`, which is created. Never writes outside it and never makes a link. */
export const extractZip = async (
  buf: Buffer,
  dest: string,
  limits: ZipLimits = ZIP_LIMITS,
): Promise<void> => {
  const entries = readZipDirectory(buf, limits);
  const root = resolve(dest);
  await fs.mkdir(root, { recursive: true });

  const within = (path: string): string => {
    const target = resolve(join(root, ...path.split('/')));
    if (!target.startsWith(root + sep)) fail('bad_package', `unsafe path in the archive: ${path}`);
    return target;
  };

  for (const entry of entries) {
    if (entry.isDir) await fs.mkdir(within(entry.path), { recursive: true });
  }
  await eachLimited(
    entries.filter((e) => !e.isDir),
    8,
    async (entry) => {
      const target = within(entry.path);
      const data = await readZipEntry(buf, entry);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    },
  );
};
