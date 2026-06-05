import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cached: string | null | undefined;

const queryRegistry = async (): Promise<string | null> => {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { windowsHide: true },
    );
    const match = stdout.match(/SteamPath\s+REG_\w+\s+(.+)/i);
    if (!match) return null;
    const raw = match[1]?.trim();
    if (!raw) return null;
    return raw.replace(/\//g, '\\');
  } catch {
    return null;
  }
};

export interface SteamPaths {
  steamDir: string;
  steamExe: string;
}

export const findSteamPaths = async (): Promise<SteamPaths | null> => {
  if (cached === undefined) cached = await queryRegistry();
  if (!cached) return null;
  const steamExe = join(cached, 'Steam.exe');
  if (!existsSync(steamExe)) return null;
  return { steamDir: cached, steamExe };
};

export const resetSteamPathCache = (): void => {
  cached = undefined;
};
