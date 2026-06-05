import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type LauncherSettings } from '@shared-types';
import { app } from 'electron';
import log from 'electron-log/main';

const FILE_NAME = 'settings.json';

const settingsFile = () => join(app.getPath('userData'), FILE_NAME);

class SettingsStore extends EventEmitter {
  private cached: LauncherSettings | null = null;

  async load(): Promise<LauncherSettings> {
    if (this.cached) return this.cached;
    try {
      const raw = await fs.readFile(settingsFile(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<LauncherSettings>;
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      if (merged.locale !== 'ru' && merged.locale !== 'en') {
        merged.locale = DEFAULT_SETTINGS.locale;
      }
      this.cached = merged;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cached = { ...DEFAULT_SETTINGS };
      } else {
        log.warn('[settings] failed to load, using defaults', err);
        this.cached = { ...DEFAULT_SETTINGS };
      }
    }
    return this.cached;
  }

  async update(patch: Partial<LauncherSettings>): Promise<LauncherSettings> {
    const current = await this.load();
    const next: LauncherSettings = { ...current, ...patch };
    await fs.writeFile(settingsFile(), JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    this.cached = next;
    this.emit('change', next);
    return next;
  }

  getCached(): LauncherSettings | null {
    return this.cached;
  }
}

const store = new SettingsStore();

export const getSettings = (): Promise<LauncherSettings> => store.load();
export const setSettings = (patch: Partial<LauncherSettings>): Promise<LauncherSettings> =>
  store.update(patch);
export const onSettingsChange = (handler: (s: LauncherSettings) => void): (() => void) => {
  store.on('change', handler);
  return () => store.off('change', handler);
};
export const getCachedSettings = (): LauncherSettings | null => store.getCached();
