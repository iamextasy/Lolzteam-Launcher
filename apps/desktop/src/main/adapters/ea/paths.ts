import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface EaPaths {
  exePath: string;
  localAppDataDir: string;
  cookiesDbPath: string;
  localPrefsPath: string;
}

let cached: EaPaths | null | undefined;

const queryRegistry = async (): Promise<string | null> => {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Electronic Arts\\EA Desktop', '/v', 'LauncherAppPath'],
      { windowsHide: true },
    );
    const match = stdout.match(/LauncherAppPath\s+REG_\w+\s+(.+)/i);
    if (!match) return null;
    return match[1]?.trim() ?? null;
  } catch {
    return null;
  }
};

export const findEaPaths = async (): Promise<EaPaths | null> => {
  if (cached !== undefined) return cached;

  const exePath = await queryRegistry();
  if (!exePath || !existsSync(exePath)) {
    cached = null;
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    cached = null;
    return null;
  }

  const localAppDataDir = join(localAppData, 'Electronic Arts', 'EA Desktop');
  const cookiesDbPath = join(
    localAppDataDir,
    'CEF',
    'BrowserCache',
    'EADesktop',
    'Network',
    'Cookies',
  );
  const localPrefsPath = join(localAppDataDir, 'CEF', 'LocalPrefs.json');

  cached = { exePath, localAppDataDir, cookiesDbPath, localPrefsPath };
  return cached;
};

export const resetEaPathCache = (): void => {
  cached = undefined;
};
