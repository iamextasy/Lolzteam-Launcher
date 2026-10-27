import { type KeyObject, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

/** Synthetic packages for the extension tests: a ZIP writer, CRX2/CRX3 signers, and file-tree helpers. */

/** CRC-32 bit by bit — deliberately not the table the reader uses, so a bug in one is not mirrored in the other. */
export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export interface ZipFile {
  readonly name: string;
  readonly data?: string | Buffer;
  /** 8 (deflate) unless said otherwise; a name ending in `/` is a directory entry. */
  readonly method?: number;
  /** General-purpose flags, e.g. 1 for "encrypted". */
  readonly flags?: number;
  /** Lies an archive can tell about an entry. */
  readonly size?: number;
  readonly crc?: number;
}

export interface ZipOptions {
  /** Bytes glued in front, as a self-extractor stub would be. */
  readonly prefix?: Buffer;
  /** Writes a ZIP64 end-of-directory locator in front of the end record. */
  readonly zip64Locator?: boolean;
}

export const makeZip = (files: readonly ZipFile[], opts: ZipOptions = {}): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const isDir = f.name.endsWith('/');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data ?? '', 'utf8');
    const method = f.method ?? (isDir ? 0 : 8);
    const body = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(f.name, 'utf8');
    const crc = f.crc ?? crc32(data);
    const size = f.size ?? data.length;
    const flags = (f.flags ?? 0) | 0x800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const locator = Buffer.alloc(opts.zip64Locator ? 20 : 0);
  if (opts.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([opts.prefix ?? Buffer.alloc(0), ...locals, cd, locator, eocd]);
};

/** A ZIP of a `{ path: contents }` tree. */
export const zipTree = (tree: Readonly<Record<string, string | Buffer>>): Buffer =>
  makeZip(Object.entries(tree).map(([name, data]) => ({ name, data })));

export interface TestKey {
  readonly publicDer: Buffer;
  readonly privateKey: KeyObject;
}

export const makeRsaKey = (): TestKey => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicDer: publicKey.export({ type: 'spki', format: 'der' }), privateKey };
};

export const makeEcKey = (): TestKey => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicDer: publicKey.export({ type: 'spki', format: 'der' }), privateKey };
};

/** The extension id of a key, computed here independently of the code under test. */
export const idOf = (der: Buffer): string =>
  createHash('sha256')
    .update(der)
    .digest('hex')
    .slice(0, 32)
    .replace(/./g, (c) => 'abcdefghijklmnop'[Number.parseInt(c, 16)]!);

const varint = (value: number): Buffer => {
  const out: number[] = [];
  let n = value;
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
};

/** A length-delimited protobuf field. */
const field = (num: number, payload: Buffer): Buffer =>
  Buffer.concat([varint(num * 8 + 2), varint(payload.length), payload]);

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

export interface Crx3Options {
  /** Whose hash goes into `crx_id`; the first RSA key by default, `null` for no signed header at all. */
  readonly idKey?: TestKey | null;
  /** ECDSA proofs, signed like the RSA ones. */
  readonly ecdsa?: readonly TestKey[];
  /** Signs something else with the ECDSA keys: the RSA proofs hold, those do not. */
  readonly forgeEcdsa?: boolean;
  /** Swaps the archive after signing — what a tampered download looks like. */
  readonly swapZip?: Buffer;
  /** A header length to write instead of the real one. */
  readonly headerLength?: number;
}

/** A CRX3 as the store ships it: `Cr24`, version 3, a protobuf header of signed proofs, the ZIP. */
export const makeCrx3 = (zip: Buffer, rsa: readonly TestKey[], opts: Crx3Options = {}): Buffer => {
  const idKey = opts.idKey === undefined ? rsa[0] : opts.idKey;
  const signedHeader = idKey
    ? field(1, createHash('sha256').update(idKey.publicDer).digest().subarray(0, 16))
    : Buffer.alloc(0);
  const signedData = Buffer.concat([
    Buffer.from('CRX3 SignedData\x00', 'latin1'),
    u32(signedHeader.length),
    signedHeader,
    zip,
  ]);
  const proof = (k: TestKey, data = signedData): Buffer =>
    Buffer.concat([field(1, k.publicDer), field(2, sign('sha256', data, k.privateKey))]);
  const ecdsaData = opts.forgeEcdsa ? Buffer.from('something else') : signedData;
  const header = Buffer.concat([
    ...rsa.map((k) => field(2, proof(k))),
    ...(opts.ecdsa ?? []).map((k) => field(3, proof(k, ecdsaData))),
    ...(signedHeader.length ? [field(10000, signedHeader)] : []),
  ]);
  return Buffer.concat([
    Buffer.from('Cr24', 'latin1'),
    u32(3),
    u32(opts.headerLength ?? header.length),
    header,
    opts.swapZip ?? zip,
  ]);
};

/** The retired CRX2: key, SHA-1 signature of the ZIP, the ZIP. */
export const makeCrx2 = (zip: Buffer, key: TestKey, swapZip?: Buffer): Buffer => {
  const signature = sign('sha1', zip, key.privateKey);
  return Buffer.concat([
    Buffer.from('Cr24', 'latin1'),
    u32(2),
    u32(key.publicDer.length),
    u32(signature.length),
    key.publicDer,
    signature,
    swapZip ?? zip,
  ]);
};

/** Writes a `{ path: contents }` tree under `root`. */
export const writeTree = async (
  root: string,
  tree: Readonly<Record<string, string | Buffer>>,
): Promise<void> => {
  for (const [path, data] of Object.entries(tree)) {
    const file = join(root, ...path.split('/'));
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
};

export const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(path, 'utf8'));

/** Eight bytes that look like a PNG to anyone checking only the extension. Not a real image, and need not be. */
export const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A small MV3 extension: worker, one content script, popup, options, icon. */
export const mv3Tree = (
  overrides: { name?: string; version?: string; manifest?: Record<string, unknown> } = {},
): Record<string, string | Buffer> => ({
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: overrides.name ?? 'Synthetic Helper',
    version: overrides.version ?? '1.0',
    description: 'A synthetic test extension',
    background: { service_worker: 'sw.js' },
    content_scripts: [{ matches: ['https://example.test/*'], js: ['cs.js'] }],
    action: { default_popup: 'popup.html' },
    options_ui: { page: 'options.html' },
    icons: { '128': 'icon.png' },
    permissions: ['storage', 'notifications'],
    host_permissions: ['https://example.test/*'],
    ...overrides.manifest,
  }),
  'sw.js': 'self.addEventListener("install", () => {});',
  'cs.js': 'void 0;',
  'popup.html': '<!doctype html><html><head><title>p</title></head><body></body></html>',
  'options.html': '<!doctype html><html><head></head><body></body></html>',
  'icon.png': FAKE_PNG,
});
