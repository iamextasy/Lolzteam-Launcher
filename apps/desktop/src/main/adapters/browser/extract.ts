import type { AccountDetails } from '@shared-types';

// A cookie ready to hand to Electron's `session.cookies.set`. We compute `url`
// ourselves from the cookie's domain so callers don't have to.
export interface InjectableCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Unix seconds. Omitted for session cookies. */
  expirationDate?: number;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

export interface BrowserLoginData {
  cookies: InjectableCookie[];
  /** Where to navigate once cookies are injected (the account's profile page). */
  landingUrl: string;
}

// Raw cookie shape as the market returns it (chrome-extension export format).
interface RawCookie {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
  path?: unknown;
  secure?: unknown;
  httpOnly?: unknown;
  session?: unknown;
  expirationDate?: unknown;
  sameSite?: unknown;
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

const SAME_SITE_VALUES = ['unspecified', 'no_restriction', 'lax', 'strict'] as const;
const normalizeSameSite = (v: unknown): InjectableCookie['sameSite'] => {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return (SAME_SITE_VALUES as readonly string[]).includes(s)
    ? (s as InjectableCookie['sameSite'])
    : 'unspecified';
};

// Build the URL Electron needs to scope the cookie. A leading dot means the
// cookie applies to all subdomains; we strip it to form a concrete host.
const cookieUrl = (domain: string, path: string, secure: boolean): string => {
  const host = domain.startsWith('.') ? domain.slice(1) : domain;
  const scheme = secure ? 'https' : 'http';
  return `${scheme}://${host}${path.startsWith('/') ? path : `/${path}`}`;
};

const toInjectable = (raw: RawCookie): InjectableCookie | null => {
  const name = asString(raw.name);
  const domain = asString(raw.domain);
  if (!name || domain === null) return null;
  // value may legitimately be an empty string, so don't use asString here.
  const value = typeof raw.value === 'string' ? raw.value : '';

  const path = asString(raw.path) ?? '/';
  const secure = raw.secure === true;
  const httpOnly = raw.httpOnly === true;

  const cookie: InjectableCookie = {
    url: cookieUrl(domain, path, secure),
    name,
    value,
    domain,
    path,
    secure,
    httpOnly,
    sameSite: normalizeSameSite(raw.sameSite),
  };

  // Persist non-session cookies; drop ones that already expired.
  if (raw.session !== true && typeof raw.expirationDate === 'number') {
    if (raw.expirationDate * 1000 <= Date.now()) return null;
    cookie.expirationDate = raw.expirationDate;
  }

  return cookie;
};

// Cookies can arrive either as a parsed array or as a JSON string (the
// single-item endpoint tends to return the latter). Coerce both to an array.
const asCookieArray = (raw: unknown): unknown[] | null => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

// Find the field holding the cookie list. The orders list exposes `cookieKey`
// (e.g. "tiktok_cookies"); the single-item endpoint may instead use a generic
// `cookies` field or a "<category>_cookies" key. Try them all, then fall back to
// scanning for any "*_cookies" / "cookies" field that yields a cookie array.
const resolveCookies = (
  secrets: Record<string, unknown>,
  categoryRaw: string,
): unknown[] | null => {
  const candidates: string[] = [];
  const explicit = asString(secrets.cookieKey);
  if (explicit) candidates.push(explicit);
  candidates.push(`${categoryRaw.toLowerCase()}_cookies`, 'cookies');

  for (const key of candidates) {
    if (key in secrets) {
      const arr = asCookieArray(secrets[key]);
      if (arr) return arr;
    }
  }

  for (const [key, val] of Object.entries(secrets)) {
    if (key === 'cookies' || key.endsWith('_cookies')) {
      const arr = asCookieArray(val);
      if (arr) return arr;
    }
  }
  return null;
};

const resolveLandingUrl = (
  secrets: Record<string, unknown>,
  cookies: InjectableCookie[],
): string => {
  const link = asString(secrets.accountLink);
  if (link) return link;
  // No explicit profile link — land on the cookie domain's root so the session
  // is at least applied somewhere meaningful.
  const domain = cookies[0]?.domain ?? '';
  const host = domain.startsWith('.') ? domain.slice(1) : domain;
  return host ? `https://${host}/` : 'about:blank';
};

export const extractBrowserLogin = (details: AccountDetails): BrowserLoginData | null => {
  const secrets = (details.secrets ?? {}) as Record<string, unknown>;
  const rawList = resolveCookies(secrets, details.categoryRaw);
  if (!rawList) return null;

  const cookies = rawList
    .map((c) => toInjectable(c as RawCookie))
    .filter((c): c is InjectableCookie => c !== null);

  if (cookies.length === 0) return null;

  return { cookies, landingUrl: resolveLandingUrl(secrets, cookies) };
};
