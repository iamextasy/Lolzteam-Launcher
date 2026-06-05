import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileExists, getTdataDir } from '../paths';

let tempDir: string;
let realExe: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'lolzteam-tg-paths-'));
  realExe = join(tempDir, 'Telegram.exe');
  await writeFile(realExe, 'fake');
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('fileExists', () => {
  it('returns true for an existing file', async () => {
    expect(await fileExists(realExe)).toBe(true);
  });

  it('returns false for a missing file', async () => {
    expect(await fileExists(join(tempDir, 'no-such-file.exe'))).toBe(false);
  });
});

describe('getTdataDir', () => {
  it('returns a sibling "tdata" directory when the parent is writable', async () => {
    const tdata = await getTdataDir(realExe);
    expect(tdata).toBe(join(tempDir, 'tdata'));
  });

  it('rejects when the parent directory does not exist', async () => {
    await expect(getTdataDir(join(tempDir, 'no-such-dir', 'Telegram.exe'))).rejects.toBeInstanceOf(
      Error,
    );
  });

  it('rejects an empty path', async () => {
    await expect(getTdataDir('')).rejects.toThrow(/пуст/);
  });

  it('rejects placing Telegram.exe directly at a filesystem root', async () => {
    const rootExe = process.platform === 'win32' ? 'C:\\Telegram.exe' : '/Telegram.exe';
    await expect(getTdataDir(rootExe)).rejects.toThrow(/корне диска/);
  });
});
