import type { AccountDetails } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { extractBrowserLogin } from '../extract';

const baseDetails = (secrets: Record<string, unknown>, categoryRaw = 'tiktok'): AccountDetails => ({
  itemId: 1,
  category: 'tiktok',
  categoryRaw,
  categoryTitle: 'TikTok',
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

const cookie = (over: Record<string, unknown> = {}) => ({
  domain: '.tiktok.com',
  name: 'sid_guard',
  value: 'abc',
  path: '/',
  secure: true,
  httpOnly: true,
  session: false,
  expirationDate: 4102444800, // year 2100
  sameSite: 'unspecified',
  ...over,
});

describe('extractBrowserLogin', () => {
  it('returns null when no cookie key resolves', () => {
    expect(extractBrowserLogin(baseDetails({}))).toBeNull();
  });

  it('reads cookies via the explicit cookieKey field', () => {
    const data = extractBrowserLogin(
      baseDetails({
        cookieKey: 'tiktok_cookies',
        tiktok_cookies: [cookie()],
        accountLink: 'https://www.tiktok.com/@user',
      }),
    );
    expect(data).not.toBeNull();
    expect(data?.cookies).toHaveLength(1);
    expect(data?.landingUrl).toBe('https://www.tiktok.com/@user');
  });

  it('falls back to "<category>_cookies" when cookieKey absent', () => {
    const data = extractBrowserLogin(baseDetails({ tiktok_cookies: [cookie()] }));
    expect(data).not.toBeNull();
    expect(data?.cookies).toHaveLength(1);
  });

  it('builds a cookie url from the domain (strips leading dot)', () => {
    const data = extractBrowserLogin(
      baseDetails({ tiktok_cookies: [cookie({ domain: '.tiktok.com', path: '/' })] }),
    );
    expect(data?.cookies[0]?.url).toBe('https://tiktok.com/');
  });

  it('uses http scheme for non-secure cookies', () => {
    const data = extractBrowserLogin(baseDetails({ tiktok_cookies: [cookie({ secure: false })] }));
    expect(data?.cookies[0]?.url).toBe('http://tiktok.com/');
  });

  it('drops cookies whose expirationDate is in the past', () => {
    const data = extractBrowserLogin(
      baseDetails({
        tiktok_cookies: [cookie({ expirationDate: 1000 }), cookie({ name: 'fresh' })],
      }),
    );
    expect(data?.cookies).toHaveLength(1);
    expect(data?.cookies[0]?.name).toBe('fresh');
  });

  it('keeps session cookies without an expirationDate', () => {
    const data = extractBrowserLogin(
      baseDetails({
        tiktok_cookies: [cookie({ session: true, expirationDate: undefined })],
      }),
    );
    expect(data?.cookies).toHaveLength(1);
    expect(data?.cookies[0]?.expirationDate).toBeUndefined();
  });

  it('normalizes unknown sameSite to "unspecified"', () => {
    const data = extractBrowserLogin(
      baseDetails({ tiktok_cookies: [cookie({ sameSite: 'weird' })] }),
    );
    expect(data?.cookies[0]?.sameSite).toBe('unspecified');
  });

  it('returns null when the cookie array is empty after filtering', () => {
    const data = extractBrowserLogin(
      baseDetails({ tiktok_cookies: [cookie({ expirationDate: 1000 })] }),
    );
    expect(data).toBeNull();
  });

  it('derives a landing url from the cookie domain when accountLink missing', () => {
    const data = extractBrowserLogin(baseDetails({ tiktok_cookies: [cookie()] }));
    expect(data?.landingUrl).toBe('https://tiktok.com/');
  });

  it('parses cookies delivered as a JSON string', () => {
    const data = extractBrowserLogin(baseDetails({ tiktok_cookies: JSON.stringify([cookie()]) }));
    expect(data).not.toBeNull();
    expect(data?.cookies).toHaveLength(1);
  });

  it('reads cookies from a generic "cookies" field', () => {
    const data = extractBrowserLogin(baseDetails({ cookies: [cookie()] }));
    expect(data).not.toBeNull();
    expect(data?.cookies).toHaveLength(1);
  });

  it('reads cookies from a generic "cookies" JSON string', () => {
    const data = extractBrowserLogin(baseDetails({ cookies: JSON.stringify([cookie()]) }));
    expect(data).not.toBeNull();
    expect(data?.cookies).toHaveLength(1);
  });

  it('scans for any "*_cookies" field when cookieKey and category guess miss', () => {
    const data = extractBrowserLogin(
      baseDetails({ instagram_cookies: [cookie({ domain: '.instagram.com' })] }, 'tiktok'),
    );
    expect(data).not.toBeNull();
    expect(data?.cookies).toHaveLength(1);
  });
});
