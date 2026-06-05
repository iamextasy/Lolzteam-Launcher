import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import type { ProxyEntry } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { buildProxySettingsContainer } from '../settings-tdf';

const TDF_MAGIC = Buffer.from('TDF$', 'ascii');

const deriveLegacyKey = (salt: Buffer): Buffer => pbkdf2Sync(Buffer.alloc(0), salt, 4, 256, 'sha1');

const prepareAesOldMtp = (authKey: Buffer, msgKey: Buffer) => {
  const x = 8;
  const sha1 = (b: Buffer) => createHash('sha1').update(b).digest();
  const a = sha1(Buffer.concat([msgKey, authKey.subarray(x, x + 32)]));
  const b = sha1(
    Buffer.concat([authKey.subarray(32 + x, 48 + x), msgKey, authKey.subarray(48 + x, 64 + x)]),
  );
  const c = sha1(Buffer.concat([authKey.subarray(64 + x, 96 + x), msgKey]));
  const d = sha1(Buffer.concat([msgKey, authKey.subarray(96 + x, 128 + x)]));
  return {
    key: Buffer.concat([a.subarray(0, 8), b.subarray(8, 20), c.subarray(4, 16)]),
    iv: Buffer.concat([a.subarray(8, 20), b.subarray(0, 8), c.subarray(16, 20), d.subarray(0, 8)]),
  };
};

const xor16 = (a: Buffer, b: Buffer): Buffer => {
  const out = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
};

const aesIgeDecrypt = (cipher: Buffer, key: Buffer, iv: Buffer): Buffer => {
  let prevC = iv.subarray(0, 16);
  let prevP = iv.subarray(16, 32);
  const out = Buffer.allocUnsafe(cipher.length);
  for (let i = 0; i < cipher.length; i += 16) {
    const c = cipher.subarray(i, i + 16);
    const dec = createDecipheriv('aes-256-ecb', key, null);
    dec.setAutoPadding(false);
    const y = Buffer.concat([dec.update(xor16(c, prevP)), dec.final()]);
    const p = xor16(y, prevC);
    p.copy(out, i);
    prevC = Buffer.from(c);
    prevP = p;
  }
  return out;
};

const decryptLocal = (encrypted: Buffer, authKey: Buffer): Buffer => {
  const msgKey = encrypted.subarray(0, 16);
  const { key, iv } = prepareAesOldMtp(authKey, msgKey);
  const plain = aesIgeDecrypt(encrypted.subarray(16), key, iv);
  expect(createHash('sha1').update(plain).digest().subarray(0, 16)).toEqual(msgKey);
  const total = plain.readUInt32LE(0);
  return plain.subarray(4, total);
};

class QtReader {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}
  i32(): number {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  qbytearray(): Buffer {
    const len = this.u32();
    const v = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return v;
  }
  qstring(): string {
    const len = this.u32();
    const raw = Buffer.from(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return raw.swap16().toString('utf16le');
  }
}

const proxy: ProxyEntry = {
  id: 'p1',
  host: '203.0.113.7',
  port: 8080,
  username: 'user',
  password: 'p@ss',
};

describe('buildProxySettingsContainer', () => {
  it('produces a valid TDF container with the proxy in a legacy block', () => {
    const container = buildProxySettingsContainer(proxy);

    expect(container.subarray(0, 4)).toEqual(TDF_MAGIC);
    expect(container.readInt32LE(4)).toBe(0); // version

    const payload = container.subarray(8, container.length - 16);
    const digest = container.subarray(container.length - 16);

    const sizeLE = Buffer.allocUnsafe(4);
    sizeLE.writeInt32LE(payload.length, 0);
    const versionLE = Buffer.allocUnsafe(4);
    versionLE.writeInt32LE(0, 0);
    const expectedDigest = createHash('md5')
      .update(payload)
      .update(sizeLE)
      .update(versionLE)
      .update(TDF_MAGIC)
      .digest();
    expect(digest).toEqual(expectedDigest);

    const pr = new QtReader(payload);
    const salt = pr.qbytearray();
    const encrypted = pr.qbytearray();
    expect(salt.length).toBe(32);

    const blocks = decryptLocal(encrypted, deriveLegacyKey(salt));
    const br = new QtReader(blocks);

    expect(br.u32()).toBe(0x4f);
    expect(br.i32()).toBe(5);
    expect(br.i32()).toBe(1);
    expect(br.i32()).toBe(1);
    expect(br.i32()).toBe(1);
    expect(br.i32()).toBe(0);

    expect(br.i32()).toBe(1026);
    expect(br.qstring()).toBe(proxy.host);
    expect(br.i32()).toBe(proxy.port);
    expect(br.qstring()).toBe('user');
    expect(br.qstring()).toBe('p@ss');
  });
});
