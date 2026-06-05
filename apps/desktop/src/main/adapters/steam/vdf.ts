import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { type VdfObject, getObj, parseVdf, writeVdfString } from './vdf-parse';

const writeFile = async (path: string, content: string): Promise<void> => {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, content, { encoding: 'utf8' });
};

const readExisting = async (path: string): Promise<VdfObject | null> => {
  try {
    const text = await fs.readFile(path, 'utf8');
    return parseVdf(text);
  } catch {
    return null;
  }
};

// Steam persona states: 0 = offline, 1 = online, 7 = invisible. To show as
// invisible the client must sign into friends, so we flip SignIntoFriends on
// and set the persona state; otherwise we keep friends sign-in off as before.
const PERSONA_INVISIBLE = '7';

export const writeLocalConfigVdf = async (path: string, invisible = false): Promise<void> => {
  const friendsLines = invisible
    ? ['\t\t"SignIntoFriends"\t\t"1"', `\t\t"ePersonaState"\t\t"${PERSONA_INVISIBLE}"`]
    : ['\t\t"SignIntoFriends"\t\t"0"'];
  await writeFile(
    path,
    [
      '"UserLocalConfigStore"',
      '{',
      '\t"streaming_v2"',
      '\t{',
      '\t\t"EnableStreaming"\t\t"0"',
      '\t}',
      '\t"friends"',
      '\t{',
      ...friendsLines,
      '\t}',
      '}',
      '',
    ].join('\n'),
  );
};

export const mergeConfigVdf = async (
  path: string,
  login: string,
  steamId64: string,
): Promise<void> => {
  const existing = (await readExisting(path)) ?? { InstallConfigStore: {} };
  const root = getObj(existing, 'InstallConfigStore');
  const software = getObj(root, 'Software');
  const valve = getObj(software, 'Valve');
  const steam = getObj(valve, 'Steam');
  const accounts = getObj(steam, 'Accounts');
  const account = getObj(accounts, login);
  account.SteamID = steamId64;
  await writeFile(path, writeVdfString(existing));
};

export const mergeLoginUsersVdf = async (
  path: string,
  login: string,
  steamId64: string,
): Promise<void> => {
  const ts = Math.round(Date.now() / 1000);
  const existing = (await readExisting(path)) ?? { users: {} };
  const users = getObj(existing, 'users');

  for (const [otherSteamId, value] of Object.entries(users)) {
    if (otherSteamId === steamId64) continue;
    if (value && typeof value === 'object') value.MostRecent = '0';
  }

  const me = getObj(users, steamId64);
  me.AccountName = login;
  me.PersonaName = typeof me.PersonaName === 'string' && me.PersonaName ? me.PersonaName : login;
  me.RememberPassword = '1';
  me.WantsOfflineMode = '0';
  me.SkipOfflineModeWarning = '0';
  me.AllowAutoLogin = '1';
  me.MostRecent = '1';
  me.Timestamp = String(ts);

  await writeFile(path, writeVdfString(existing));
};

export const mergeLocalVdf = async (
  path: string,
  hdr: string,
  encryptedHex: string,
): Promise<void> => {
  const existing = (await readExisting(path)) ?? { MachineUserConfigStore: {} };
  const root = getObj(existing, 'MachineUserConfigStore');
  const software = getObj(root, 'Software');
  const valve = getObj(software, 'Valve');
  const steam = getObj(valve, 'Steam');
  const cache = getObj(steam, 'ConnectCache');
  cache[hdr] = encryptedHex;
  await writeFile(path, writeVdfString(existing));
};
