import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const refreshAccessToken = vi.fn<() => Promise<string>>();
const getWebCookies = vi.fn<() => Promise<string[]>>();

class FakeLoginSession {
  refreshToken = '';
  accessToken = '';
  async refreshAccessToken(): Promise<void> {
    this.accessToken = await refreshAccessToken();
  }
  getWebCookies(): Promise<string[]> {
    return getWebCookies();
  }
}

vi.mock('steam-session', () => ({
  EAuthTokenPlatformType: { MobileApp: 2 },
  LoginSession: FakeLoginSession,
}));

const getGuardRecord = vi.fn();

vi.mock('../session-store', () => ({
  getGuardRecord,
  saveGuardRecord: vi.fn(),
  deleteGuardRecord: vi.fn(),
}));

vi.mock('../../../accounts/local-store', () => ({ getLocalAccount: vi.fn(async () => null) }));
vi.mock('../../../adapters/steam/extract', () => ({ extractSteamCreds: vi.fn() }));
vi.mock('../../../adapters/steam/mafile', () => ({ generateDeviceId: vi.fn(() => 'android:x') }));
vi.mock('../../../adapters/steam/session', () => ({ acquireMobileSession: vi.fn() }));
vi.mock('../../../settings/settings-store', () => ({
  getSettings: vi.fn(async () => ({ proxyEnabled: false, proxies: [] })),
}));
const fetchAccountDetails = vi.fn();

vi.mock('../../market', () => ({
  fetchSteamMafileData: vi.fn(),
  fetchAccountDetails,
}));
vi.mock('../../proxy', () => ({ proxyUrlFor: vi.fn(() => 'http://proxy') }));
vi.mock('../../confirm-broker', () => ({ askAccountConfirm: vi.fn(async () => false) }));

const { getGuardAccessToken, getGuardWebCookies, linkGuardAccount, resetGuardTokensForTests } =
  await import('../session');

const { emitGuardRecordDropped } = await import('../cache-events');

const RECORD = {
  accountId: 1,
  steamId: '76561198000000001',
  accountName: 'main',
  refreshToken: 'refresh',
  sharedSecret: null,
  identitySecret: null,
  deviceId: 'android:x',
  proxyId: null,
  createdAt: 0,
  updatedAt: 0,
};

/** A rejection that carries what Steam attaches when it answers and says no. */
const refusal = (): Error => Object.assign(new Error('refused'), { eresult: 5 });

/** A call that connects and then says nothing — the case with no deadline of its own. */
const forever = (): Promise<never> => new Promise<never>(() => {});

/** A token shaped the way `LoginApprover` insists on: minted for the mobile app. */
const mobileToken = (sub: string): string => {
  // A fixed, distant expiry — the same `sub` must always give the same string.
  const claims = { sub, aud: ['web', 'mobile'], exp: 2_000_000_000 };
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetGuardTokensForTests();
  getGuardRecord.mockResolvedValue(RECORD);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getGuardAccessToken', () => {
  // Without the deadline this call never settles: the row it belongs to never finishes, the run summary is never written.
  it('gives up on a refresh that never answers, and calls it the network', async () => {
    vi.useFakeTimers();
    refreshAccessToken.mockImplementation(forever);

    const pending = getGuardAccessToken(1);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await pending).toMatchObject({ ok: false, reason: 'network' });
  });

  it('still calls an answer from Steam an expired session', async () => {
    refreshAccessToken.mockRejectedValue(refusal());
    expect(await getGuardAccessToken(1)).toMatchObject({ ok: false, reason: 'session_expired' });
  });

  it('mints once and keeps the token', async () => {
    refreshAccessToken.mockResolvedValue(mobileToken('76561198000000001'));

    expect(await getGuardAccessToken(1)).toMatchObject({ ok: true });
    expect(await getGuardAccessToken(1)).toMatchObject({ ok: true });
    // Every mint is a device session on the account; twice for one question is exactly what the refresh token exists to avoid.
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  // Local ids are handed out again after a delete.
  it('forgets the token when the record behind it is dropped', async () => {
    refreshAccessToken.mockResolvedValue(mobileToken('76561198000000001'));
    await getGuardAccessToken(-1);

    emitGuardRecordDropped(-1);
    refreshAccessToken.mockResolvedValue(mobileToken('76561198000000002'));

    expect(await getGuardAccessToken(-1)).toMatchObject({
      ok: true,
      token: mobileToken('76561198000000002'),
    });
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe('getGuardWebCookies', () => {
  it('hands back the cookies it was given', async () => {
    getWebCookies.mockResolvedValue(['sessionid=abc']);
    expect(await getGuardWebCookies(1)).toEqual({ ok: true, cookies: ['sessionid=abc'] });
  });

  // Telling the user to relink is a fifty-account chore.
  it('separates a dead network from a dead session', async () => {
    getWebCookies.mockRejectedValue(new Error('ECONNRESET'));
    expect(await getGuardWebCookies(1)).toEqual({ ok: false, reason: 'network' });

    getWebCookies.mockRejectedValue(refusal());
    expect(await getGuardWebCookies(1)).toEqual({ ok: false, reason: 'session_expired' });
  });

  it('gives up on a mint that never answers', async () => {
    vi.useFakeTimers();
    getWebCookies.mockImplementation(forever);

    const pending = getGuardWebCookies(1);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await pending).toEqual({ ok: false, reason: 'network' });
  });

  it('reports an account with no record instead of building a session for it', async () => {
    getGuardRecord.mockResolvedValue(null);
    expect(await getGuardWebCookies(1)).toEqual({ ok: false, reason: 'not_linked' });
    expect(getWebCookies).not.toHaveBeenCalled();
  });
});

/** The half of linking that happens before Steam is ever contacted. */
describe('linkGuardAccount before it reaches Steam', () => {
  it('does not report a market it could not reach as a missing account', async () => {
    fetchAccountDetails.mockResolvedValue({
      ok: false,
      reason: 'unreachable',
      detail: '429 Too Many Requests',
    });
    expect(await linkGuardAccount(1)).toEqual({ ok: false, reason: 'network' });
  });

  it('still reports an item that is genuinely gone as gone', async () => {
    fetchAccountDetails.mockResolvedValue({ ok: false, reason: 'not_found' });
    expect(await linkGuardAccount(1)).toEqual({ ok: false, reason: 'no_account' });
  });
});
