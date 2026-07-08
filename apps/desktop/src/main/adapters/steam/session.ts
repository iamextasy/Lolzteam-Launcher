import { EAuthSessionGuardType, EAuthTokenPlatformType, LoginSession } from 'steam-session';
import { generateSteamGuardCode } from './mafile';

export type SessionError =
  | { kind: 'needs-email-code' }
  | { kind: 'needs-totp' }
  | { kind: 'needs-device-confirm' }
  | { kind: 'needs-email-confirm' }
  | { kind: 'bad-credentials'; message: string }
  | { kind: 'unknown'; message: string };

export interface SessionSuccess {
  refreshToken: string;
  accessToken: string | null;
  steamId: string;
  accountName: string;
}

export type SessionResult = { ok: true; data: SessionSuccess } | { ok: false; error: SessionError };

interface GuardAction {
  type: EAuthSessionGuardType;
}

const waitAuth = (session: LoginSession): Promise<void> =>
  new Promise((resolve, reject) => {
    session.on('authenticated', () => resolve());
    session.on('timeout', () => reject(new Error('Login timed out')));
    session.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });

interface LoginParams {
  login: string;
  password: string;
  sharedSecret: string | null;
  emailCode?: string;
}

export const acquireRefreshToken = async (params: LoginParams): Promise<SessionResult> =>
  (await runCredentialLogin(params, EAuthTokenPlatformType.SteamClient)).result;

export type WebSessionResult =
  | { ok: true; data: SessionSuccess & { cookies: string[] } }
  | { ok: false; error: SessionError };

// Web login: authenticate with the WebBrowser platform (getWebCookies only
// works for WebBrowser/MobileApp tokens) and exchange the session for cookies.
// For WebBrowser, getWebCookies returns full Set-Cookie strings (with Domain/
// Path/Secure attributes) valid across the Steam web hosts.
export const acquireWebSession = async (params: LoginParams): Promise<WebSessionResult> => {
  const { result, session } = await runCredentialLogin(params, EAuthTokenPlatformType.WebBrowser);
  if (!result.ok) return result;
  try {
    const cookies = await session.getWebCookies();
    return { ok: true, data: { ...result.data, cookies } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { kind: 'unknown', message: `Не удалось получить web-куки: ${msg}` },
    };
  }
};

const runCredentialLogin = async (
  params: LoginParams,
  platform: EAuthTokenPlatformType,
): Promise<{ result: SessionResult; session: LoginSession }> => {
  const session = new LoginSession(platform, { machineId: true });
  const failWith = (error: SessionError): { result: SessionResult; session: LoginSession } => ({
    result: { ok: false, error },
    session,
  });

  let start: Awaited<ReturnType<LoginSession['startWithCredentials']>>;
  try {
    start = await session.startWithCredentials({
      accountName: params.login,
      password: params.password,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid|password|credential/i.test(msg)) {
      return failWith({ kind: 'bad-credentials', message: msg });
    }
    return failWith({ kind: 'unknown', message: msg });
  }

  if (start.actionRequired) {
    const actions = (start.validActions ?? []) as GuardAction[];
    const has = (t: EAuthSessionGuardType) => actions.some((a) => a.type === t);

    if (has(EAuthSessionGuardType.DeviceCode) && params.sharedSecret) {
      const code = generateSteamGuardCode(params.sharedSecret);
      try {
        await session.submitSteamGuardCode(code);
      } catch (err) {
        return failWith({
          kind: 'unknown',
          message: `Steam Guard TOTP отклонён: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else if (has(EAuthSessionGuardType.EmailCode)) {
      if (!params.emailCode) {
        return failWith({ kind: 'needs-email-code' });
      }
      try {
        await session.submitSteamGuardCode(params.emailCode);
      } catch (err) {
        return failWith({
          kind: 'unknown',
          message: `Email-код отклонён: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else if (has(EAuthSessionGuardType.DeviceCode)) {
      // DeviceCode guard but no shared_secret on hand — caller can fetch the
      // mafile and retry with a TOTP.
      return failWith({ kind: 'needs-totp' });
    } else if (has(EAuthSessionGuardType.DeviceConfirmation)) {
      return failWith({ kind: 'needs-device-confirm' });
    } else if (has(EAuthSessionGuardType.EmailConfirmation)) {
      return failWith({ kind: 'needs-email-confirm' });
    }
  }

  try {
    await waitAuth(session);
  } catch (err) {
    return failWith({
      kind: 'unknown',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (!session.refreshToken || !session.steamID) {
    return failWith({ kind: 'unknown', message: 'No refresh token returned' });
  }

  return {
    result: {
      ok: true,
      data: {
        refreshToken: session.refreshToken,
        accessToken: session.accessToken || null,
        steamId: session.steamID.toString(),
        accountName: session.accountName ?? params.login,
      },
    },
    session,
  };
};
