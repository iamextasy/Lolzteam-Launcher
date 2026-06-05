import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { findSteamPaths } from './paths';
import { killSteamProcesses, waitForSteamExit } from './process';
import { clearAutoLoginUser } from './registry';
import { type VdfObject, getObj, parseVdf, writeVdfString } from './vdf-parse';

export interface ClearSteamSessionResult {
  ok: boolean;
  message?: string;
}

const rewriteVdf = async (path: string, mutate: (root: VdfObject) => boolean): Promise<void> => {
  let text: string;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch {
    return; // File doesn't exist — nothing to clear.
  }
  const root = parseVdf(text);
  if (!mutate(root)) return;
  await fs.writeFile(path, writeVdfString(root), { encoding: 'utf8' });
};

const clearObject = (obj: VdfObject): boolean => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  for (const key of keys) delete obj[key];
  return true;
};

export const clearSteamSession = async (): Promise<ClearSteamSessionResult> => {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Очистка Steam доступна только на Windows' };
  }

  const paths = await findSteamPaths();
  if (!paths) {
    return { ok: false, message: 'Steam не найден в системе (проверьте установку)' };
  }

  await killSteamProcesses();
  await waitForSteamExit(5000);

  const steamConfigDir = join(paths.steamDir, 'config');
  const localAppData = process.env.LOCALAPPDATA;

  await rewriteVdf(join(steamConfigDir, 'loginusers.vdf'), (root) => {
    const users = root.users;
    if (!users || typeof users !== 'object') return false;
    return clearObject(users);
  });

  await rewriteVdf(join(steamConfigDir, 'config.vdf'), (root) => {
    const store = root.InstallConfigStore;
    if (!store || typeof store !== 'object') return false;
    const steam = getObj(getObj(getObj(store, 'Software'), 'Valve'), 'Steam');
    const accounts = steam.Accounts;
    if (!accounts || typeof accounts !== 'object') return false;
    return clearObject(accounts);
  });

  if (localAppData) {
    await rewriteVdf(join(localAppData, 'Steam', 'local.vdf'), (root) => {
      const store = root.MachineUserConfigStore;
      if (!store || typeof store !== 'object') return false;
      const steam = getObj(getObj(getObj(store, 'Software'), 'Valve'), 'Steam');
      const cache = steam.ConnectCache;
      if (!cache || typeof cache !== 'object') return false;
      return clearObject(cache);
    });
  }

  await clearAutoLoginUser();

  return { ok: true };
};
