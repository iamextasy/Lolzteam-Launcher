import { constants, access, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { fileExists as sharedFileExists } from '../_shared/fs';

export const fileExists = sharedFileExists;

// Telegram Desktop reads `tdata/` from the exe directory ONLY if an empty
// marker file `tportable.tdat` sits next to the exe. Without it, the exe
// ignores the local tdata and reads/writes `%APPDATA%\Telegram Desktop`.
// Idempotent: creates the file once, skips if it's already there.
export const ensurePortableMarker = async (telegramExePath: string): Promise<void> => {
  const marker = join(dirname(telegramExePath), 'tportable.tdat');
  if (await sharedFileExists(marker)) return;
  await writeFile(marker, '');
};

// tdata lives next to the portable Telegram.exe.
// Validates that:
//   - the path is non-empty
//   - the parent directory exists and is writable
//   - the parent is not a filesystem root (we don't want to dump tdata into C:\)
// Returns `<parent>/tdata` so the caller can rm+rewrite it on each login.
export const getTdataDir = async (telegramExePath: string): Promise<string> => {
  if (!telegramExePath || !telegramExePath.trim()) {
    throw new Error('Путь к Telegram.exe пуст');
  }
  const parent = dirname(telegramExePath);
  const parsed = parse(parent);
  if (parent === parsed.root) {
    throw new Error(
      'Telegram.exe не должен лежать в корне диска — поместите его в отдельную папку',
    );
  }
  await access(parent, constants.W_OK);
  return join(parent, 'tdata');
};
