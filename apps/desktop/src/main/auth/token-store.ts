import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import log from 'electron-log/main';

const FILE_NAME = 'auth.bin';

const tokenFile = () => join(app.getPath('userData'), FILE_NAME);

class TokenStore extends EventEmitter {
  private cached: string | null | undefined = undefined;

  async load(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const buf = await fs.readFile(tokenFile());
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn('[auth] safeStorage unavailable, reading token as plaintext');
        this.cached = buf.toString('utf8');
      } else {
        this.cached = safeStorage.decryptString(buf);
      }
      return this.cached;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cached = null;
        return null;
      }
      log.error('[auth] failed to load token', err);
      this.cached = null;
      return null;
    }
  }

  async save(token: string): Promise<void> {
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token)
      : Buffer.from(token, 'utf8');
    await fs.writeFile(tokenFile(), payload, { mode: 0o600 });
    this.cached = token;
    this.emit('change', token);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(tokenFile());
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[auth] failed to remove token file', err);
      }
    }
    this.cached = null;
    this.emit('change', null);
  }
}

const store = new TokenStore();

export const saveToken = (token: string) => store.save(token);
export const loadToken = () => store.load();
export const clearToken = () => store.clear();
export const onTokenChange = (handler: (token: string | null) => void) => {
  store.on('change', handler);
  return () => store.off('change', handler);
};
