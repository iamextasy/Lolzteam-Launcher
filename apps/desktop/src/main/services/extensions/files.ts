import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fail } from './errors';
import { ZIP_LIMITS, type ZipLimits } from './zip';

export const exists = (path: string): Promise<boolean> =>
  fs.access(path).then(
    () => true,
    () => false,
  );

export const removeDir = (path: string): Promise<void> =>
  fs.rm(path, { recursive: true, force: true, maxRetries: 3 });

/** Whether `child` is strictly inside `parent` (case-insensitively on Windows, as `path.relative` compares there). */
export const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** `base`, or `base-2`, `base-3`… — the first name not taken in `parent`. */
export const freeName = async (parent: string, base: string): Promise<string> => {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!(await exists(join(parent, name)))) return name;
  }
};

/** Written beside and renamed over: a crash leaves the old file or the new one, never half of either. */
export const writeFileAtomic = async (path: string, data: string): Promise<void> => {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
};

/** A rename, or a copy when the rename is refused (another drive; a scanner holding a file on Windows). */
export const moveDir = async (from: string, to: string): Promise<void> => {
  try {
    await fs.rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err;
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await removeDir(from);
  }
};

/** Version-control and Finder litter: never part of an extension, and `.git` can be most of a folder's size. */
const SKIP = new Set(['.git', '.svn', '.hg', '.DS_Store', '__MACOSX']);

/**
 * Copies an unpacked extension folder, held to the same limits as an archive. A link to a file inside the folder is
 * copied as the file; any other link is skipped — a folder link may loop, and a link out of the folder would hand
 * whatever it points at (a key, a password store) to the extension.
 */
export const copyFolder = async (
  src: string,
  dest: string,
  limits: ZipLimits = ZIP_LIMITS,
): Promise<void> => {
  let entries = 0;
  let total = 0;
  const realRoot = await fs.realpath(src);
  const walk = async (from: string, to: string): Promise<void> => {
    await fs.mkdir(to, { recursive: true });
    for (const d of await fs.readdir(from, { withFileTypes: true })) {
      if (SKIP.has(d.name)) continue;
      if (++entries > limits.maxEntries) fail('too_large', `over ${limits.maxEntries} files`);
      const source = join(from, d.name);
      const target = join(to, d.name);
      if (d.isDirectory()) {
        await walk(source, target);
        continue;
      }
      if (d.isSymbolicLink()) {
        const real = await fs.realpath(source).catch(() => null);
        if (!real || !isInside(realRoot, real)) continue;
      } else if (!d.isFile()) {
        continue;
      }
      const stat = await fs.stat(source).catch(() => null);
      if (!stat?.isFile()) continue;
      if (stat.size > limits.maxFileBytes) fail('too_large', `${d.name} is ${stat.size} bytes`);
      total += stat.size;
      if (total > limits.maxTotalBytes) fail('too_large', `over ${limits.maxTotalBytes} bytes`);
      await fs.copyFile(source, target);
    }
  };
  await walk(src, dest);
};
