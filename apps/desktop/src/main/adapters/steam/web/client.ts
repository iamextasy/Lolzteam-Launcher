import { randomBytes, randomUUID } from 'node:crypto';
import type { ProxyEntry } from '@shared-types';
import { net, type Session, session } from 'electron';
import { applyProxyToSession } from '../../../services/proxy';
import type { InjectableCookie } from '../../browser/extract';
import { webCookiesToInjectable } from '../web-cookies';
import { USER_AGENT } from './hosts';

export class SteamWebError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SteamWebError';
  }
}

export type HttpResult = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

const SKIP = new Set(['host', 'content-length', 'connection']);

export class SteamWebClient {
  private constructor(
    readonly ses: Session,
    private readonly partition: string,
  ) {}

  static async create(proxy?: ProxyEntry | null): Promise<SteamWebClient> {
    const partition = `temp:steam-web-${randomUUID()}`;
    const ses = session.fromPartition(partition);
    if (proxy) {
      await applyProxyToSession(ses, proxy);
    } else {
      await ses.setProxy({ mode: 'system' });
      await ses.closeAllConnections();
    }
    return new SteamWebClient(ses, partition);
  }

  async injectSetCookies(raw: string[]): Promise<void> {
    const cookies = webCookiesToInjectable(raw);
    for (const cookie of cookies) {
      try {
        await this.ses.cookies.set(cookie as Electron.CookiesSetDetails);
      } catch {
        // ignore malformed / rejected cookies
      }
    }
  }

  async ensureSessionId(url: string): Promise<string> {
    const existing = await this.ses.cookies.get({ url, name: 'sessionid' });
    const value = existing[0]?.value;
    if (value) return value;

    const id = randomBytes(12).toString('hex');
    const u = new URL(url);
    const cookie: InjectableCookie = {
      url: `${u.protocol}//${u.host}/`,
      name: 'sessionid',
      value: id,
      domain: u.hostname,
      path: '/',
      secure: u.protocol === 'https:',
      httpOnly: false,
      sameSite: 'no_restriction',
    };
    await this.ses.cookies.set(cookie as Electron.CookiesSetDetails);
    return id;
  }

  request(
    url: string,
    opts: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<HttpResult> {
    const method = opts.method ?? 'GET';
    const bodyBuf = opts.body !== undefined ? Buffer.from(opts.body) : undefined;

    return new Promise<HttpResult>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const req = net.request({
        method,
        url,
        session: this.ses,
        useSessionCookies: true,
      });

      req.setHeader('User-Agent', USER_AGENT);
      req.setHeader('Accept-Language', 'en,ru;q=0.9');
      for (const [k, v] of Object.entries(opts.headers ?? {})) {
        if (!SKIP.has(k.toLowerCase())) req.setHeader(k, v);
      }

      req.on('login', (authInfo, cb) => {
        if (!authInfo.isProxy) cb();
      });

      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue;
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
          }
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
            headers,
          });
        });
        res.on('error', (err: Error) => fail(err));
      });

      req.on('error', (err: Error) => fail(err));

      if (opts.signal) {
        if (opts.signal.aborted) {
          req.abort();
          fail(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        opts.signal.addEventListener(
          'abort',
          () => {
            req.abort();
            fail(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true },
        );
      }

      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  }

  get(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<HttpResult> {
    return this.request(url, { method: 'GET', headers, signal });
  }

  postForm(
    url: string,
    fields: Record<string, string>,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<HttpResult> {
    const body = new URLSearchParams(fields).toString();
    return this.request(url, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...headers,
      },
      signal,
    });
  }

  async dispose(): Promise<void> {
    try {
      await this.ses.clearStorageData();
    } catch {
      // ignore
    }
  }
}
