import { randomUUID } from 'node:crypto';
import type { ProxyTestResult } from '@shared-ipc';
import type { ProxyEntry } from '@shared-types';
import { net, type Session, app, session } from 'electron';
import log from 'electron-log/main';

type ProxyCreds = { username: string; password: string };

const credsByHostPort = new Map<string, ProxyCreds>();

const hostPortKey = (host: string, port: number): string => `${host}:${port}`;

export const proxyRulesFor = (entry: Pick<ProxyEntry, 'host' | 'port'>): string =>
  `http://${entry.host}:${entry.port}`;

const registerProxyCreds = (
  entry: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password'>,
): void => {
  if (entry.username) {
    credsByHostPort.set(hostPortKey(entry.host, entry.port), {
      username: entry.username,
      password: entry.password ?? '',
    });
  }
};

export const applyProxyToSession = async (ses: Session, entry: ProxyEntry): Promise<void> => {
  registerProxyCreds(entry);
  await ses.setProxy({ proxyRules: proxyRulesFor(entry) });
};

export const clearProxyFromSession = async (ses: Session): Promise<void> => {
  await ses.setProxy({ mode: 'direct' });
};

let authHandlerWired = false;

export const registerProxyAuthHandler = (): void => {
  if (authHandlerWired) return;
  authHandlerWired = true;

  app.on('login', (event, _webContents, _request, authInfo, callback) => {
    if (!authInfo.isProxy) return;
    const creds = credsByHostPort.get(hostPortKey(authInfo.host, authInfo.port));
    if (!creds) return;
    event.preventDefault();
    callback(creds.username, creds.password);
  });
};

const TEST_TIMEOUT_MS = 10_000;
const TEST_URL = 'https://api.ipify.org?format=json';

export const testProxy = (
  input: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password'>,
): Promise<ProxyTestResult> => {
  return new Promise<ProxyTestResult>((resolve) => {
    const ses = session.fromPartition(`proxy-test-${randomUUID()}`);
    registerProxyCreds(input);

    let settled = false;
    const finish = (result: ProxyTestResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void ses.clearStorageData().catch(() => {});
      resolve(result);
    };

    const started = Date.now();
    const timer = setTimeout(() => {
      try {
        req.abort();
      } catch {
        // ignore
      }
      finish({ ok: false, message: 'Таймаут подключения' });
    }, TEST_TIMEOUT_MS);

    let req: Electron.ClientRequest;

    ses
      .setProxy({ proxyRules: proxyRulesFor(input) })
      .then(() => {
        req = net.request({ session: ses, url: TEST_URL, useSessionCookies: false });

        req.on('login', (authInfo, cb) => {
          if (authInfo.isProxy && input.username) {
            cb(input.username, input.password ?? '');
          } else {
            cb();
          }
        });

        req.on('response', (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (c) => chunks.push(c));
          response.on('end', () => {
            const ms = Date.now() - started;
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              const ip = (JSON.parse(body) as { ip?: string }).ip;
              if (response.statusCode === 200 && ip) {
                finish({ ok: true, ms, ip });
              } else {
                finish({ ok: false, message: `HTTP ${response.statusCode}` });
              }
            } catch {
              finish({ ok: false, message: 'Некорректный ответ' });
            }
          });
        });

        req.on('error', (err) => {
          log.warn('[proxy] test failed', err);
          finish({ ok: false, message: err.message });
        });

        req.end();
      })
      .catch((err: unknown) => {
        finish({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  });
};
