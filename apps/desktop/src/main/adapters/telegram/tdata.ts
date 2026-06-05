import { Tdata, convertFromTdata, convertToTdata } from '@mtcute/convert';
import { readStringSession } from '@mtcute/node/utils.js';
import type { StringSessionData } from '@mtcute/node/utils.js';

export type TdataSession = string | StringSessionData;

// Telegram Desktop (free tier) shows at most 3 accounts; extra entries written
// into tdata are simply ignored by the client. Cap to the same number so the
// oldest account is evicted instead of silently dropped by TDesktop.
const MAX_ACCOUNTS = 3;

// A session string carries the same data as StringSessionData; normalize so we
// can inspect `self.userId` for dedup before writing.
export const toSessionData = (session: TdataSession): StringSessionData =>
  typeof session === 'string' ? readStringSession(session) : session;

interface ReadLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

// Read every account already stored in tdata. Returns [] on any failure
// (local passcode, corruption, version mismatch) so the caller falls back to a
// single-account write rather than crashing. `ignoreVersion` lets us read tdata
// that Telegram Desktop re-saved with a newer TDF version than mtcute expects.
export const readExistingSessions = async (
  tdataDir: string,
  log?: ReadLogger,
): Promise<StringSessionData[]> => {
  try {
    const tdata = await Tdata.open({ path: tdataDir, ignoreVersion: true });
    const order = tdata.keyData.order;
    log?.info(`[telegram] tdata opened: ${order.length} account(s) in order`);
    const sessions: StringSessionData[] = [];
    for (const idx of order) {
      try {
        sessions.push(await convertFromTdata(tdata, idx));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log?.warn(`[telegram] failed to read tdata account #${idx}: ${msg}`);
      }
    }
    return sessions;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn(`[telegram] could not open existing tdata (will overwrite): ${msg}`);
    return [];
  }
};

// Pure: put the freshly-logged-in account first (it becomes active), drop any
// prior entry for the same user, and cap the total. Offline auth_key sessions
// have no `self`, so they can't be deduped — they're just prepended.
export const mergeSessions = (
  incoming: StringSessionData,
  existing: StringSessionData[],
): StringSessionData[] => {
  const incomingId = incoming.self?.userId ?? null;
  const kept =
    incomingId === null ? existing : existing.filter((s) => s.self?.userId !== incomingId);
  return [incoming, ...kept].slice(0, MAX_ACCOUNTS);
};

// Accepts either a single session (string or StringSessionData) or an array.
// `convertToTdata` writes every session into one tdata and marks index 0 active.
export const writeTdata = async (
  sessions: TdataSession | TdataSession[],
  tdataDir: string,
): Promise<void> => {
  await convertToTdata(sessions, { path: tdataDir });
};
