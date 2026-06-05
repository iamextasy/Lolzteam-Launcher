import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

const linuxDesktopFileName = (scheme: string) => `lolzteam-${scheme}-handler.desktop`;

const linuxDesktopFilePath = (scheme: string) =>
  join(homedir(), '.local', 'share', 'applications', linuxDesktopFileName(scheme));

const escapeDesktopExec = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const buildLinuxDesktopFile = (
  scheme: string,
  electronBinary: string,
  projectRoot: string,
  productName: string,
): string => {
  const exec = `"${escapeDesktopExec(electronBinary)}" "${escapeDesktopExec(projectRoot)}" %u`;
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${productName} (${scheme}://)`,
    'Comment=Deep-link handler for OAuth callback',
    `Exec=${exec}`,
    'Terminal=false',
    'NoDisplay=true',
    `MimeType=x-scheme-handler/${scheme};`,
    'Categories=Network;',
    '',
  ].join('\n');
};

const run = (cmd: string, args: string[]) =>
  new Promise<void>((done) => {
    execFile(cmd, args, (err) => {
      if (err) log.warn(`[lolz][protocol] ${cmd} failed:`, err.message);
      done();
    });
  });

const resolveDevProjectRoot = (): string => {
  const argvEntry = process.argv[1];
  if (argvEntry) {
    const absEntry = isAbsolute(argvEntry) ? argvEntry : resolve(process.cwd(), argvEntry);
    if (existsSync(absEntry)) {
      const lower = absEntry.toLowerCase();
      if (lower.includes('out/main') || lower.includes('out\\main')) {
        return resolve(dirname(absEntry), '..', '..');
      }
      if (existsSync(join(absEntry, 'package.json'))) return absEntry;
      return dirname(absEntry);
    }
  }
  return process.cwd();
};

export const registerProtocol = async (scheme: string): Promise<void> => {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(scheme);
  } else {
    const projectRoot = resolveDevProjectRoot();
    app.setAsDefaultProtocolClient(scheme, process.execPath, [projectRoot]);
  }

  if (process.platform === 'linux' && !app.isPackaged) {
    await writeLinuxDesktopFile(scheme);
  }
};

const writeLinuxDesktopFile = async (scheme: string) => {
  const target = linuxDesktopFilePath(scheme);
  const electronBinary = process.execPath;
  const projectRoot = resolveDevProjectRoot();
  const productName = app.getName?.() || 'Lolzteam Launcher';
  const content = buildLinuxDesktopFile(scheme, electronBinary, projectRoot, productName);

  try {
    await fs.mkdir(dirname(target), { recursive: true });
    let needWrite = true;
    try {
      const existing = await fs.readFile(target, 'utf8');
      if (existing === content) needWrite = false;
    } catch {
      needWrite = true;
    }
    if (needWrite) {
      await fs.writeFile(target, content, { mode: 0o644 });
      log.info(`[lolz][protocol] wrote ${target}`);
      await run('update-desktop-database', [dirname(target)]);
      await run('xdg-mime', [
        'default',
        linuxDesktopFileName(scheme),
        `x-scheme-handler/${scheme}`,
      ]);
    }
  } catch (err) {
    log.warn('[lolz][protocol] failed to register linux desktop file:', err);
  }
};
