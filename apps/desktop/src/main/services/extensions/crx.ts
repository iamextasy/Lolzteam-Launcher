import { type KeyObject, createHash, createPublicKey, createVerify } from 'node:crypto';
import { fail } from './errors';

/** A `.crx` taken apart: the ZIP inside, and the key that names the extension. */
export interface CrxPackage {
  readonly zip: Buffer;
  /** DER SubjectPublicKeyInfo of the developer key, or `null` for an unsigned package. */
  readonly publicKey: Buffer | null;
  /** The extension id that key gives, or `null` with no key. */
  readonly id: string | null;
}

/** Chromium refuses a CRX3 header bigger than this, and so do we. */
export const MAX_CRX_HEADER = 1 << 18;

/** What every CRX3 signature covers, ahead of the signed header and the archive. */
const SIGNED_PREFIX = Buffer.from('CRX3 SignedData\x00', 'latin1');

/** CrxFileHeader fields (components/crx_file/crx3.proto). */
const FIELD_SHA256_WITH_RSA = 2;
const FIELD_SHA256_WITH_ECDSA = 3;
const FIELD_SIGNED_HEADER_DATA = 10000;
/** AsymmetricKeyProof and SignedData fields. */
const FIELD_PUBLIC_KEY = 1;
const FIELD_SIGNATURE = 2;
const FIELD_CRX_ID = 1;

function bad(why: string): never {
  fail('bad_package', `broken CRX: ${why}`);
}

/** The first 16 bytes of a SHA-256, written the way Chrome writes extension ids: hex digits as `a`–`p`. */
const toId = (bytes: Uint8Array): string =>
  Array.from(Buffer.from(bytes).toString('hex'), (c) =>
    String.fromCharCode(97 + Number.parseInt(c, 16)),
  ).join('');

/** The id Chrome gives an extension signed with (or carrying, as `manifest.key`) this DER public key. */
export const idFromPublicKey = (spki: Uint8Array): string =>
  toId(createHash('sha256').update(spki).digest().subarray(0, 16));

export const isCrx = (buf: Buffer): boolean =>
  buf.length >= 4 && buf.toString('latin1', 0, 4) === 'Cr24';

/** `[value, position after it]`. */
const readVarint = (buf: Buffer, start: number): [number, number] => {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10; i++) {
    const byte = buf[start + i];
    if (byte === undefined) bad('truncated header');
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, start + i + 1];
    scale *= 128;
  }
  return bad('varint too long');
};

/** Just enough protobuf: every length-delimited field, by number; everything else is skipped. */
const decodeMessage = (buf: Buffer): Map<number, Buffer[]> => {
  const fields = new Map<number, Buffer[]>();
  let pos = 0;
  while (pos < buf.length) {
    const [key, afterKey] = readVarint(buf, pos);
    pos = afterKey;
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 0) bad('field number 0');
    switch (wire) {
      case 0:
        pos = readVarint(buf, pos)[1];
        break;
      case 1:
        pos += 8;
        break;
      case 2: {
        const [len, afterLen] = readVarint(buf, pos);
        pos = afterLen;
        if (pos + len > buf.length) bad('field runs past the header');
        const list = fields.get(field) ?? [];
        list.push(buf.subarray(pos, pos + len));
        fields.set(field, list);
        pos += len;
        break;
      }
      case 5:
        pos += 4;
        break;
      default:
        bad(`wire type ${wire}`);
    }
    if (pos > buf.length) bad('truncated header');
  }
  return fields;
};

interface KeyProof {
  readonly publicKey: Buffer;
  readonly signature: Buffer;
}

const readProof = (raw: Buffer): KeyProof => {
  const fields = decodeMessage(raw);
  const publicKey = fields.get(FIELD_PUBLIC_KEY)?.at(-1);
  const signature = fields.get(FIELD_SIGNATURE)?.at(-1);
  if (!publicKey || !signature) bad('a key proof without a key or a signature');
  return { publicKey: Buffer.from(publicKey), signature: Buffer.from(signature) };
};

const publicKeyOf = (der: Buffer): KeyObject => {
  try {
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return bad('unreadable public key');
  }
};

const verifies = (
  algorithm: string,
  parts: readonly Uint8Array[],
  der: Buffer,
  signature: Buffer,
): boolean => {
  const key = publicKeyOf(der);
  const verifier = createVerify(algorithm);
  for (const part of parts) verifier.update(part);
  try {
    return verifier.verify(key, signature);
  } catch {
    return false;
  }
};

const parseCrx3 = (buf: Buffer): CrxPackage => {
  if (buf.length < 12) bad('truncated');
  const headerLen = buf.readUInt32LE(8);
  if (headerLen > MAX_CRX_HEADER) bad(`header of ${headerLen} bytes`);
  if (12 + headerLen > buf.length) bad('header runs past the file');
  const header = decodeMessage(buf.subarray(12, 12 + headerLen));
  const zip = buf.subarray(12 + headerLen);

  const rsa = (header.get(FIELD_SHA256_WITH_RSA) ?? []).map(readProof);
  const ecdsa = (header.get(FIELD_SHA256_WITH_ECDSA) ?? []).map(readProof);
  const signedHeader = header.get(FIELD_SIGNED_HEADER_DATA)?.at(-1) ?? Buffer.alloc(0);
  const crxId = signedHeader.length
    ? (decodeMessage(signedHeader).get(FIELD_CRX_ID)?.at(-1) ?? null)
    : null;
  if (crxId && crxId.length !== 16) bad('crx_id is not 16 bytes');

  // As Chromium does: every proof present must hold, the store's as well as the developer's.
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeader.length);
  const signed = [SIGNED_PREFIX, length, signedHeader, zip];
  for (const proof of [...rsa, ...ecdsa]) {
    if (!verifies('sha256', signed, proof.publicKey, proof.signature)) {
      bad('signature does not match the contents');
    }
  }

  if (crxId) {
    // The developer's key is the proof whose hash is the id; the store adds a proof of its own.
    const own = rsa.find((p) =>
      createHash('sha256').update(p.publicKey).digest().subarray(0, 16).equals(crxId),
    );
    if (!own) bad('no key proof matches the declared id');
    return { zip, publicKey: own.publicKey, id: toId(crxId) };
  }
  const first = rsa[0];
  return first
    ? { zip, publicKey: first.publicKey, id: idFromPublicKey(first.publicKey) }
    : { zip, publicKey: null, id: null };
};

/** CRX2, long retired by the store but still found on disk: key, SHA-1 signature, archive. */
const parseCrx2 = (buf: Buffer): CrxPackage => {
  if (buf.length < 16) bad('truncated');
  const keyLen = buf.readUInt32LE(8);
  const sigLen = buf.readUInt32LE(12);
  if (keyLen + sigLen > MAX_CRX_HEADER) bad('header too large');
  if (16 + keyLen + sigLen > buf.length) bad('header runs past the file');
  const publicKey = Buffer.from(buf.subarray(16, 16 + keyLen));
  const signature = Buffer.from(buf.subarray(16 + keyLen, 16 + keyLen + sigLen));
  const zip = buf.subarray(16 + keyLen + sigLen);
  if (!verifies('sha1', [zip], publicKey, signature)) bad('signature does not match the contents');
  return { zip, publicKey, id: idFromPublicKey(publicKey) };
};

/** Takes a `.crx` apart and checks its signatures; any mismatch is a `bad_package`. */
export const parseCrx = (buf: Buffer): CrxPackage => {
  if (!isCrx(buf)) bad('no Cr24 magic');
  if (buf.length < 8) bad('truncated');
  const version = buf.readUInt32LE(4);
  if (version === 3) return parseCrx3(buf);
  if (version === 2) return parseCrx2(buf);
  return bad(`format version ${version}`);
};
