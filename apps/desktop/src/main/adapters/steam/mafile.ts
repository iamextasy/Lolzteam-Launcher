import { createHmac } from 'node:crypto';

const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

export const generateSteamGuardCode = (sharedSecretBase64: string, now = Date.now()): string => {
  const key = Buffer.from(sharedSecretBase64, 'base64');
  const time = BigInt(Math.floor(now / 1000 / 30));

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(time);

  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  let code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  let out = '';
  for (let i = 0; i < 5; i++) {
    out += STEAM_ALPHABET[code % STEAM_ALPHABET.length];
    code = Math.floor(code / STEAM_ALPHABET.length);
  }
  return out;
};

interface MafileShape {
  shared_secret?: string;
  sharedSecret?: string;
  // The `GET /{item_id}/mafile` endpoint nests the secret under `maFile`.
  maFile?: MafileShape;
}

export const extractSharedSecret = (raw: unknown): string | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return extractSharedSecret(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object') return null;
  const obj = raw as MafileShape;
  return obj.shared_secret ?? obj.sharedSecret ?? extractSharedSecret(obj.maFile) ?? null;
};
