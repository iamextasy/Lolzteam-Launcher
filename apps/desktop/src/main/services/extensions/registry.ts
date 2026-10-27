import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BrowserExtensionInfo } from '@shared-types';
import { writeFileAtomic } from './files';
import { isValidVersion, splitPageRef } from './manifest';
import { EXTENSION_ID } from './webstore';

export const REGISTRY_FILE = 'registry.json';
const REGISTRY_VERSION = 1;

/** One installed extension, as `registry.json` keeps it. */
export interface RegistryEntry extends BrowserExtensionInfo {
  /** `<id>/<folder>`, relative to the extensions root. */
  readonly dir: string;
  /** Page references relative to the extension root, query kept. */
  readonly popupPage: string | null;
  readonly optionsPage: string | null;
  /** The shim version the folder was patched with. */
  readonly patchVersion: number;
  /** Base64 SPKI the launcher made up for a keyless package, reused by a later version of it to keep the id. */
  readonly generatedKey: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const stringList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v] : null;

const pageOrNull = (v: unknown): string | null | undefined => {
  if (v === null) return null;
  const page = splitPageRef(v);
  return page ? `${page.file}${page.suffix}` : undefined;
};

/** One entry as this build spells it, or `null`. The folder must sit under the id's own directory. */
const parseEntry = (v: unknown): RegistryEntry | null => {
  if (!isObject(v)) return null;
  const { id, dir } = v;
  if (typeof id !== 'string' || !EXTENSION_ID.test(id)) return null;
  if (typeof dir !== 'string') return null;
  const parts = dir.split('/');
  const folder = parts[1];
  if (
    parts.length !== 2 ||
    parts[0] !== id ||
    !folder ||
    folder.startsWith('.') ||
    /[\\:]/.test(folder)
  ) {
    return null;
  }
  const permissions = stringList(v.permissions);
  const hostPermissions = stringList(v.hostPermissions);
  const popupPage = pageOrNull(v.popupPage);
  const optionsPage = pageOrNull(v.optionsPage);
  if (
    typeof v.name !== 'string' ||
    !isValidVersion(v.version) ||
    typeof v.description !== 'string' ||
    typeof v.enabled !== 'boolean' ||
    (v.source !== 'webstore' && v.source !== 'file') ||
    (v.manifestVersion !== 2 && v.manifestVersion !== 3) ||
    !permissions ||
    !hostPermissions ||
    popupPage === undefined ||
    optionsPage === undefined ||
    (v.icon !== null && (typeof v.icon !== 'string' || !v.icon.startsWith('data:image/'))) ||
    typeof v.installedAt !== 'number' ||
    typeof v.patchVersion !== 'number' ||
    (v.generatedKey !== null && typeof v.generatedKey !== 'string')
  ) {
    return null;
  }
  return {
    id,
    name: v.name,
    version: v.version,
    description: v.description,
    enabled: v.enabled,
    source: v.source,
    manifestVersion: v.manifestVersion,
    permissions,
    hostPermissions,
    hasPopup: popupPage !== null,
    hasOptions: optionsPage !== null,
    icon: v.icon,
    installedAt: v.installedAt,
    dir,
    popupPage,
    optionsPage,
    patchVersion: v.patchVersion,
    generatedKey: v.generatedKey,
  };
};

export interface ParsedRegistry {
  readonly entries: RegistryEntry[];
  /** How many entries were dropped as unreadable. */
  readonly dropped: number;
}

/** `null` when the file is not a registry at all; otherwise its readable entries, one per id. */
export const parseRegistry = (data: unknown): ParsedRegistry | null => {
  if (!isObject(data) || data.version !== REGISTRY_VERSION || !Array.isArray(data.extensions)) {
    return null;
  }
  const entries: RegistryEntry[] = [];
  let dropped = 0;
  for (const raw of data.extensions) {
    const entry = parseEntry(raw);
    if (!entry || entries.some((e) => e.id === entry.id)) dropped++;
    else entries.push(entry);
  }
  return { entries, dropped };
};

/** `[]` when there is no file yet; throws when there is one this build cannot read. */
export const readRegistry = async (root: string): Promise<ParsedRegistry> => {
  let text: string;
  try {
    text = await fs.readFile(join(root, REGISTRY_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], dropped: 0 };
    throw err;
  }
  const parsed = parseRegistry(JSON.parse(text));
  if (!parsed) throw new Error(`${REGISTRY_FILE} is not a registry this build understands`);
  return parsed;
};

export const writeRegistry = (root: string, entries: readonly RegistryEntry[]): Promise<void> =>
  writeFileAtomic(
    join(root, REGISTRY_FILE),
    `${JSON.stringify({ version: REGISTRY_VERSION, extensions: entries }, null, 2)}\n`,
  );

/** What the renderer and the toolbars are shown: no paths, no keys. */
export const toExtensionInfo = (e: RegistryEntry): BrowserExtensionInfo => ({
  id: e.id,
  name: e.name,
  version: e.version,
  description: e.description,
  enabled: e.enabled,
  source: e.source,
  manifestVersion: e.manifestVersion,
  permissions: [...e.permissions],
  hostPermissions: [...e.hostPermissions],
  hasPopup: e.hasPopup,
  hasOptions: e.hasOptions,
  icon: e.icon,
  installedAt: e.installedAt,
});
