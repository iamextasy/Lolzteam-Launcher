import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProxyEntry } from '@shared-types';

const TDF_MAGIC = Buffer.from('TDF$', 'ascii');
const TDF_VERSION = 0;

const DBI_CONNECTION_TYPE_OLD = 0x4f;
const DBICT_PROXIES_LIST = 5;

const PROXY_SETTINGS_ENABLED = 1;
const LEGACY_PROXY_TYPE_HTTP = 1026;

class QtWriter {
  private chunks: Buffer[] = [];

  i32(value: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32BE(value | 0, 0);
    this.chunks.push(b);
  }

  u32(value: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(value >>> 0, 0);
    this.chunks.push(b);
  }

  qbytearray(value: Buffer): void {
    this.u32(value.length);
    this.chunks.push(value);
  }

  qstring(value: string): void {
    const raw = Buffer.from(value, 'utf16le').swap16();
    this.u32(raw.length);
    this.chunks.push(raw);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const deriveLegacyKey = (salt: Buffer): Buffer => pbkdf2Sync(Buffer.alloc(0), salt, 4, 256, 'sha1');

const prepareAesOldMtp = (authKey: Buffer, msgKey: Buffer): { key: Buffer; iv: Buffer } => {
  const x = 8;
  const sha1 = (b: Buffer) => createHash('sha1').update(b).digest();
  const a = sha1(Buffer.concat([msgKey, authKey.subarray(x, x + 32)]));
  const b = sha1(
    Buffer.concat([authKey.subarray(32 + x, 48 + x), msgKey, authKey.subarray(48 + x, 64 + x)]),
  );
  const c = sha1(Buffer.concat([authKey.subarray(64 + x, 96 + x), msgKey]));
  const d = sha1(Buffer.concat([msgKey, authKey.subarray(96 + x, 128 + x)]));

  const key = Buffer.concat([a.subarray(0, 8), b.subarray(8, 20), c.subarray(4, 16)]);
  const iv = Buffer.concat([
    a.subarray(8, 20),
    b.subarray(0, 8),
    c.subarray(16, 20),
    d.subarray(0, 8),
  ]);
  return { key, iv };
};

const xor16 = (a: Buffer, b: Buffer): Buffer => {
  const out = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
};

const aesIgeEncrypt = (plain: Buffer, key: Buffer, iv: Buffer): Buffer => {
  let prevC = iv.subarray(0, 16);
  let prevP = iv.subarray(16, 32);
  const out = Buffer.allocUnsafe(plain.length);
  for (let i = 0; i < plain.length; i += 16) {
    const p = plain.subarray(i, i + 16);
    const cipher = createCipheriv('aes-256-ecb', key, null);
    cipher.setAutoPadding(false);
    const y = Buffer.concat([cipher.update(xor16(p, prevC)), cipher.final()]);
    const c = xor16(y, prevP);
    c.copy(out, i);
    prevC = c;
    prevP = Buffer.from(p);
  }
  return out;
};

const encryptLocal = (blocks: Buffer, authKey: Buffer): Buffer => {
  const size = blocks.length + 4;
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(size, 0);
  let plain = Buffer.concat([header, blocks]);
  const rem = plain.length % 16;
  if (rem !== 0) plain = Buffer.concat([plain, randomBytes(16 - rem)]);

  const msgKey = createHash('sha1').update(plain).digest().subarray(0, 16);
  const { key, iv } = prepareAesOldMtp(authKey, msgKey);
  return Buffer.concat([msgKey, aesIgeEncrypt(plain, key, iv)]);
};

const encodeProxyBlock = (proxy: ProxyEntry): Buffer => {
  const w = new QtWriter();
  w.u32(DBI_CONNECTION_TYPE_OLD);
  w.i32(DBICT_PROXIES_LIST);

  w.i32(1);
  w.i32(1);
  w.i32(PROXY_SETTINGS_ENABLED);
  w.i32(0);

  w.i32(LEGACY_PROXY_TYPE_HTTP);
  w.qstring(proxy.host);
  w.i32(proxy.port);
  w.qstring(proxy.username ?? '');
  w.qstring(proxy.password ?? '');

  return w.toBuffer();
};

const buildTdfContainer = (blocks: Buffer): Buffer => {
  const salt = randomBytes(32);
  const authKey = deriveLegacyKey(salt);
  const encrypted = encryptLocal(blocks, authKey);

  const payloadWriter = new QtWriter();
  payloadWriter.qbytearray(salt);
  payloadWriter.qbytearray(encrypted);
  const payload = payloadWriter.toBuffer();

  const versionLE = Buffer.allocUnsafe(4);
  versionLE.writeInt32LE(TDF_VERSION, 0);
  const sizeLE = Buffer.allocUnsafe(4);
  sizeLE.writeInt32LE(payload.length, 0);

  const digest = createHash('md5')
    .update(payload)
    .update(sizeLE)
    .update(versionLE)
    .update(TDF_MAGIC)
    .digest();

  return Buffer.concat([TDF_MAGIC, versionLE, payload, digest]);
};

export const buildProxySettingsContainer = (proxy: ProxyEntry): Buffer =>
  buildTdfContainer(encodeProxyBlock(proxy));

export const writeProxySettings = async (tdataDir: string, proxy: ProxyEntry): Promise<void> => {
  const container = buildProxySettingsContainer(proxy);
  await writeFile(join(tdataDir, 'settingss'), container);
};
