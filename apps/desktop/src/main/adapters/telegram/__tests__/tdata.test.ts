import { DC_MAPPING_PROD } from '@mtcute/convert';
import type { StringSessionData } from '@mtcute/node/utils.js';
import { describe, expect, it } from 'vitest';
import { mergeSessions } from '../tdata';

const DC2 = DC_MAPPING_PROD[2] ?? 0;

const session = (userId: number | null): StringSessionData => ({
  version: 3,
  primaryDcs: DC2,
  authKey: new Uint8Array(256),
  self: userId === null ? null : { userId, isBot: false, isPremium: false, usernames: [] },
});

const ids = (sessions: StringSessionData[]): (number | null | undefined)[] =>
  sessions.map((s) => s.self?.userId ?? null);

describe('mergeSessions', () => {
  it('returns just the incoming session when nothing exists', () => {
    expect(ids(mergeSessions(session(1), []))).toEqual([1]);
  });

  it('replaces an existing account with the same userId (no duplicate, incoming first)', () => {
    const merged = mergeSessions(session(2), [session(1), session(2), session(3)]);
    expect(ids(merged)).toEqual([2, 1, 3]);
  });

  it('caps the total at 3, evicting the oldest', () => {
    const merged = mergeSessions(session(4), [session(1), session(2), session(3)]);
    expect(ids(merged)).toEqual([4, 1, 2]);
  });

  it('does not dedup an incoming session without `self` (offline auth_key)', () => {
    const merged = mergeSessions(session(null), [session(1), session(2)]);
    expect(ids(merged)).toEqual([null, 1, 2]);
  });
});
