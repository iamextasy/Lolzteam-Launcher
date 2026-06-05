import { describe, expect, it } from 'vitest';
import { buildOfflineSession } from '../session';

const HEX_256 = 'a'.repeat(512);

describe('buildOfflineSession', () => {
  it('builds a v3 string session from a valid auth_key + dc', () => {
    const session = buildOfflineSession({ authKeyHex: HEX_256, dcId: 2, userId: 123 });
    expect(session.version).toBe(3);
    expect(session.authKey).toHaveLength(256);
    expect(session.primaryDcs.main.id).toBe(2);
  });

  it('populates self.userId so TDesktop accepts the account', () => {
    const session = buildOfflineSession({ authKeyHex: HEX_256, dcId: 2, userId: 777 });
    expect(session.self?.userId).toBe(777);
  });

  it('omits self when no userId is available', () => {
    const session = buildOfflineSession({ authKeyHex: HEX_256, dcId: 2, userId: null });
    expect(session.self).toBeUndefined();
  });

  it('throws on unknown dc id', () => {
    expect(() => buildOfflineSession({ authKeyHex: HEX_256, dcId: 99, userId: 1 })).toThrow(
      /Неизвестный DC/,
    );
  });

  it('throws on wrong auth_key length', () => {
    expect(() => buildOfflineSession({ authKeyHex: 'abcd', dcId: 2, userId: 1 })).toThrow(
      /256 байт/,
    );
  });
});
