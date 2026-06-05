import type { AccountDetails } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { extractTelegramCreds } from '../extract';

const HEX_256 = 'a'.repeat(512);
const HEX_256_B = 'b'.repeat(512);
const HEX_TOO_SHORT = 'a'.repeat(510);

const baseDetails = (secrets: Record<string, unknown>): AccountDetails => ({
  itemId: 1,
  category: 'telegram',
  categoryRaw: 'telegram',
  categoryTitle: 'Telegram',
  title: 'test',
  description: '',
  price: 0,
  currency: 'RUB',
  imageUrl: null,
  tags: [],
  warrantyEndsAt: null,
  publishedAt: null,
  purchasedAt: null,
  isPurchased: true,
  steam: null,
  telegram: null,
  loginRaw: null,
  passwordRaw: null,
  secrets,
});

describe('extractTelegramCreds', () => {
  it('reads phone from telegram_phone and password from telegram_password_value', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        telegram_password_value: 'my2fa',
      }),
    );
    expect(creds).not.toBeNull();
    expect(creds?.phone).toBe('+15807812822');
    expect(creds?.password).toBe('my2fa');
    expect(creds?.authKey).toBeNull();
  });

  it('reads apiId / apiHash from telegram_json', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        telegram_json: { app_id: 2040, app_hash: 'deadbeef' },
      }),
    );
    expect(creds?.apiId).toBe(2040);
    expect(creds?.apiHash).toBe('deadbeef');
  });

  it('parses authKey from loginData.raw with `<hex>:<dc>` shape', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        loginData: { raw: `${HEX_256}:2` },
      }),
    );
    expect(creds?.authKey).not.toBeNull();
    expect(creds?.authKey?.authKeyHex).toBe(HEX_256);
    expect(creds?.authKey?.dcId).toBe(2);
  });

  it('parses authKey from loginData.raw without dc suffix when telegram_json.dc_id is present', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        telegram_json: { dc_id: 4 },
        loginData: { raw: HEX_256_B },
      }),
    );
    expect(creds?.authKey).not.toBeNull();
    expect(creds?.authKey?.dcId).toBe(4);
  });

  it('rejects authKey shorter than 256 bytes', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        loginData: { raw: `${HEX_TOO_SHORT}:1` },
      }),
    );
    expect(creds?.authKey).toBeNull();
  });

  it('rejects authKey with an invalid dc id', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        loginData: { raw: `${HEX_256}:99` },
      }),
    );
    expect(creds?.authKey).toBeNull();
  });

  it('falls back gracefully when only authKey is available (no phone)', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        loginData: { raw: `${HEX_256}:1` },
      }),
    );
    expect(creds).not.toBeNull();
    expect(creds?.phone).toBe('');
    expect(creds?.authKey?.dcId).toBe(1);
  });

  it('returns null when there is neither phone nor authKey', () => {
    const creds = extractTelegramCreds(baseDetails({}));
    expect(creds).toBeNull();
  });

  it('rejects implausible phone numbers when authKey is also absent', () => {
    const creds = extractTelegramCreds(baseDetails({ telegram_phone: '12' }));
    expect(creds).toBeNull();
  });

  it('keeps authKey usable even when phone is malformed', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '12',
        loginData: { raw: `${HEX_256}:2` },
      }),
    );
    expect(creds).not.toBeNull();
    expect(creds?.phone).toBe('');
    expect(creds?.authKey?.dcId).toBe(2);
  });

  it('ignores telegram_password (flag) and reads only telegram_password_value', () => {
    const creds = extractTelegramCreds(
      baseDetails({
        telegram_phone: '15807812822',
        telegram_password: 1,
        telegram_password_value: 'real',
      }),
    );
    expect(creds?.password).toBe('real');
  });
});
