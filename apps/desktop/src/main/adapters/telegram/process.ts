import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const findPidsByPath = async (exePath: string): Promise<number[]> => {
  if (process.platform !== 'win32') return [];
  const target = exePath.replace(/\//g, '\\').toLowerCase();
  const name = basename(exePath).replace(/'/g, "''");
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "Name='${name}'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`,
      ],
      { windowsHide: true, encoding: 'utf8' },
    );
    const pids: number[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const pid = Number(line.slice(0, sep).trim());
      const path = line
        .slice(sep + 1)
        .trim()
        .replace(/\//g, '\\')
        .toLowerCase();
      if (Number.isInteger(pid) && pid > 0 && path === target) pids.push(pid);
    }
    return pids;
  } catch {
    return [];
  }
};

export const killTelegramProcesses = async (exePath: string): Promise<void> => {
  if (process.platform !== 'win32') return;
  const pids = await findPidsByPath(exePath);
  for (const pid of pids) {
    try {
      await execFileAsync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true });
    } catch {}
  }
};

export const waitForTelegramExit = async (exePath: string, timeoutMs = 5000): Promise<void> => {
  if (process.platform !== 'win32') return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await findPidsByPath(exePath)).length === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
};
