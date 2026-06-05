import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS, parseAuthCallback } from '@shared-ipc';
import type { AuthTokenPayload } from '@shared-types';
import { type BrowserWindow, session } from 'electron';
import log from 'electron-log/main';
import { saveToken } from './token-store';

type GetWindow = () => BrowserWindow | null;

interface StateRecord {
  value: string;
  createdAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const RECENT_TOKEN_TTL_MS = 30 * 1000;

const states = new Map<string, StateRecord>();
const recentTokens = new Map<string, number>();

export const issueState = (): string => {
  const value = randomUUID();
  states.set(value, { value, createdAt: Date.now() });
  pruneStates();
  return value;
};

const pruneStates = () => {
  const now = Date.now();
  for (const [k, v] of states) {
    if (now - v.createdAt > STATE_TTL_MS) states.delete(k);
  }
};

const consumeState = (state: string | null): boolean => {
  if (!state) return states.size === 0;
  const rec = states.get(state);
  if (!rec) return false;
  if (Date.now() - rec.createdAt > STATE_TTL_MS) {
    states.delete(state);
    return false;
  }
  states.delete(state);
  return true;
};

const isRecentToken = (token: string): boolean => {
  const now = Date.now();
  for (const [k, ts] of recentTokens) {
    if (now - ts > RECENT_TOKEN_TTL_MS) recentTokens.delete(k);
  }
  if (recentTokens.has(token)) return true;
  recentTokens.set(token, now);
  return false;
};

export type AuthOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'no-token' | 'state-mismatch' | 'duplicate' | 'oauth-error';
      message?: string;
    };

export const acceptAuthCallback = async (
  url: string,
  getMainWindow: GetWindow,
): Promise<AuthOutcome> => {
  const parsed = parseAuthCallback(url);

  if (parsed.error) {
    const msg = parsed.errorDescription || parsed.error;
    log.warn('[auth] oauth error:', msg);
    return { ok: false, reason: 'oauth-error', message: msg };
  }

  if (!parsed.accessToken) return { ok: false, reason: 'no-token' };

  if (!consumeState(parsed.state)) {
    log.warn('[auth] state mismatch — ignoring callback');
    return { ok: false, reason: 'state-mismatch' };
  }

  if (isRecentToken(parsed.accessToken)) return { ok: false, reason: 'duplicate' };

  await saveToken(parsed.accessToken);

  const payload: AuthTokenPayload = {
    accessToken: parsed.accessToken,
    state: parsed.state,
    expiresIn: parsed.expiresIn,
    tokenType: parsed.tokenType,
  };

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.send(IPC_CHANNELS.AUTH_TOKEN_RECEIVED, payload);
  }

  return { ok: true };
};

export const clearAuthSession = async (partition: string): Promise<void> => {
  try {
    const ses = session.fromPartition(partition);
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    });
  } catch (err) {
    log.warn('[auth] clearAuthSession failed:', err);
  }
};
