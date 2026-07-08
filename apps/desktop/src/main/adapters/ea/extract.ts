import type { AccountDetails } from "@shared-types";

export interface EaCreds {
  email: string;
  password: string;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const EMAIL_KEYS = [
  "email",
  "login",
  "account_email",
  "account_login",
  "username",
] as const;
const PASSWORD_KEYS = [
  "password",
  "account_password",
  "password_original",
] as const;

const pickFromKeys = (
  source: Record<string, unknown>,
  keys: readonly string[]
): string | null => {
  for (const k of keys) {
    const found = asString(source[k]);
    if (found) return found;
  }
  return null;
};

export const extractEaCreds = (details: AccountDetails): EaCreds | null => {
  const secrets = (details.secrets ?? {}) as Record<string, unknown>;
  const ld =
    secrets.loginData && typeof secrets.loginData === "object"
      ? (secrets.loginData as Record<string, unknown>)
      : null;

  const email =
    asString(ld?.email) ??
    asString(ld?.login) ??
    pickFromKeys(secrets, EMAIL_KEYS) ??
    details.loginRaw;

  const password =
    asString(ld?.password) ??
    pickFromKeys(secrets, PASSWORD_KEYS) ??
    details.passwordRaw;

  if (!email || !password) return null;
  return { email, password };
};
