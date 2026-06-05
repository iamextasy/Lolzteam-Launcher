import type { AccountDetails } from '@shared-types';
import { extractSharedSecret } from './mafile';

export interface SteamCreds {
  login: string;
  password: string;
  sharedSecret: string | null;
}

interface LoginDataShape {
  login?: string;
  password?: string;
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const pickLoginData = (secrets: Record<string, unknown>): LoginDataShape | null => {
  const ld = secrets.loginData;
  if (ld && typeof ld === 'object') return ld as LoginDataShape;
  return null;
};

const LEGACY_LOGIN_KEYS = [
  'login_original',
  'account_login',
  'steam_login',
  'steam_username',
  'account_name',
  'login',
  'username',
] as const;

const LEGACY_PASSWORD_KEYS = [
  'password_original',
  'account_password',
  'steam_password',
  'password',
] as const;

const MAFILE_KEYS = ['steam_mafile', 'mafile', 'mafile_data'] as const;

const pickFromKeys = (source: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const k of keys) {
    const found = asString(source[k]);
    if (found) return found;
  }
  return null;
};

export const extractSteamCreds = (details: AccountDetails): SteamCreds | null => {
  const secrets = (details.secrets ?? {}) as Record<string, unknown>;

  const loginData = pickLoginData(secrets);
  const login =
    asString(loginData?.login) ?? pickFromKeys(secrets, LEGACY_LOGIN_KEYS) ?? details.loginRaw;
  const password =
    asString(loginData?.password) ??
    pickFromKeys(secrets, LEGACY_PASSWORD_KEYS) ??
    details.passwordRaw;

  if (!login || !password) return null;

  let sharedSecret: string | null = null;
  for (const key of MAFILE_KEYS) {
    sharedSecret = extractSharedSecret(secrets[key]);
    if (sharedSecret) break;
  }

  return { login, password, sharedSecret };
};
