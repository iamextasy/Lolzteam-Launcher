import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionError } from '../errors';
import {
  type Fetcher,
  checkWebstoreUpdate,
  crxDownloadUrl,
  downloadWebstoreCrx,
  isNewer,
  parseUpdateCheck,
  parseWebstoreInput,
  updateCheckUrl,
} from '../webstore';

/** Synthetic ids — any 32 letters a–p are an id. */
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER = 'ponmlkjihgfedcbaponmlkjihgfedcba';

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ExtensionError) return err.code;
    throw err;
  }
  throw new Error('expected a failure');
};

describe('parseWebstoreInput', () => {
  it.each([
    [ID, ID],
    [`  ${ID.toUpperCase()}  `, ID],
    [`https://chromewebstore.google.com/detail/synthetic-helper/${ID}`, ID],
    [`https://chromewebstore.google.com/detail/synthetic-helper/${ID}?hl=ru&utm_source=x`, ID],
    [`https://chromewebstore.google.com/detail/${ID}`, ID],
    [`https://chromewebstore.google.com/detail/synthetic-helper/${ID}/reviews`, ID],
    [`chromewebstore.google.com/detail/synthetic-helper/${ID}`, ID],
    [`https://chrome.google.com/webstore/detail/synthetic-helper/${ID}`, ID],
    [`https://chrome.google.com/webstore/detail/synthetic-helper/${ID}?hl=en#x`, ID],
    [`http://chrome.google.com/webstore/detail/${ID}`, ID],
    [`https://CHROMEWEBSTORE.GOOGLE.COM/detail/x/${ID}`, ID],
  ])('reads %j', (input, id) => {
    expect(parseWebstoreInput(input)).toBe(id);
  });

  it.each([
    '',
    'hello',
    'abcdefghijklmnopabcdefghijklmnoq', // q is not a hex letter
    'abcdefghijklmnopabcdefghijklmno', // 31 letters
    `https://evil.test/detail/x/${ID}`,
    `https://chromewebstore.google.com.evil.test/detail/x/${ID}`,
    `https://chromewebstore.google.com/search/${ID}`,
    `https://chrome.google.com/detail/x/${ID}`,
    `https://user:pass@chromewebstore.google.com/detail/x/${ID}`,
    `https://chromewebstore.google.com:8443/detail/x/${ID}`,
    `ftp://chromewebstore.google.com/detail/x/${ID}`,
    `javascript:alert(1)//${ID}`,
    'https://chromewebstore.google.com/detail/synthetic-helper/notanid',
    `https://microsoftedge.microsoft.com/addons/detail/x/${ID}`,
  ])('refuses %j', (input) => {
    expect(parseWebstoreInput(input)).toBeNull();
  });
});

describe('store URLs', () => {
  it('ask for a CRX3 for the Chromium this build is on', () => {
    expect(crxDownloadUrl(ID)).toMatch(
      new RegExp(
        `^https://clients2\\.google\\.com/service/update2/crx\\?response=redirect&prodversion=[\\d.]+&acceptformat=crx2,crx3&x=id%3D${ID}%26uc$`,
      ),
    );
    expect(updateCheckUrl(ID, '1.2.3')).toContain('response=updatecheck');
    expect(updateCheckUrl(ID, '1.2.3')).toContain(`x=id%3D${ID}%26v%3D1.2.3%26uc`);
  });
});

const HASH = 'a'.repeat(64);
const gupdate = (app: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod"><daystart elapsed_days="7000" elapsed_seconds="1"/>${app}</gupdate>`;

describe('parseUpdateCheck', () => {
  it('reads a newer version and its hash', () => {
    const xml = gupdate(
      `<app appid="${ID}" cohort="1::" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/blobs/x/y.crx" fp="1.${HASH}" hash_sha256="${HASH.toUpperCase()}" protocol="2.0" size="123" status="ok" version="2.12.1"/></app>`,
    );
    expect(parseUpdateCheck(xml, ID)).toEqual({
      status: 'update',
      version: '2.12.1',
      sha256: HASH,
    });
  });

  it('reads "nothing newer"', () => {
    const xml = gupdate(`<app appid="${ID}" status="ok"><updatecheck status="noupdate"/></app>`);
    expect(parseUpdateCheck(xml, ID)).toEqual({ status: 'noupdate' });
  });

  it('reads an unknown extension as not found', () => {
    expect(
      parseUpdateCheck(gupdate(`<app appid="${ID}" status="error-unknownApplication"/>`), ID),
    ).toEqual({ status: 'not_found' });
    expect(
      parseUpdateCheck(
        gupdate(`<app appid="${ID}" status="ok"><updatecheck status="error-internal"/></app>`),
        ID,
      ),
    ).toEqual({ status: 'not_found' });
  });

  it('keeps an update without a usable hash, and refuses one without a valid version', () => {
    const noHash = gupdate(
      `<app appid="${ID}" status="ok"><updatecheck status="ok" version="1.0" hash_sha256="nope"/></app>`,
    );
    expect(parseUpdateCheck(noHash, ID)).toEqual({
      status: 'update',
      version: '1.0',
      sha256: null,
    });
    const badVersion = gupdate(
      `<app appid="${ID}" status="ok"><updatecheck status="ok" version="1.0.0.0.0"/></app>`,
    );
    expect(parseUpdateCheck(badVersion, ID)).toBeNull();
  });

  it('reads only the app it was asked about', () => {
    const xml = gupdate(
      `<app appid="${OTHER}" status="ok"><updatecheck status="ok" version="9.9"/></app><app appid="${ID}" status="ok"><updatecheck status="noupdate"/></app>`,
    );
    expect(parseUpdateCheck(xml, ID)).toEqual({ status: 'noupdate' });
    expect(parseUpdateCheck(gupdate(''), ID)).toBeNull();
    expect(parseUpdateCheck('<html>captive portal</html>', ID)).toBeNull();
  });
});

const respond =
  (
    body: ConstructorParameters<typeof Response>[0],
    init: ConstructorParameters<typeof Response>[1] = {},
  ): Fetcher =>
  async () =>
    new Response(body, init);

describe('downloadWebstoreCrx', () => {
  const payload = Buffer.from('Cr24 synthetic package bytes');
  const sha = createHash('sha256').update(payload).digest('hex');

  it('downloads the package and checks it against the store hash', async () => {
    const fetcher = vi.fn(respond(payload));
    const got = await downloadWebstoreCrx(ID, { sha256: sha, fetcher });
    expect(got.equals(payload)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(crxDownloadUrl(ID), expect.anything());
  });

  it('refuses bytes that do not match the hash', async () => {
    expect(
      await codeOf(downloadWebstoreCrx(ID, { sha256: 'b'.repeat(64), fetcher: respond(payload) })),
    ).toBe('download_failed');
  });

  it('reads 204 and 404 as "no such extension"', async () => {
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: respond(null, { status: 204 }) }))).toBe(
      'not_found',
    );
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: respond('', { status: 404 }) }))).toBe(
      'not_found',
    );
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: respond('') }))).toBe('not_found');
  });

  it('reads any other status, and a dead network, as a failed download', async () => {
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: respond('x', { status: 503 }) }))).toBe(
      'download_failed',
    );
    const offline: Fetcher = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: offline }))).toBe('download_failed');
  });

  it('stops at the size cap, whether the size is declared or not', async () => {
    const declared = respond(payload, { headers: { 'content-length': '999999999999' } });
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: declared }))).toBe('too_large');

    let pulled = 0;
    const endless: Fetcher = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            controller.enqueue(new Uint8Array(1024));
          },
        }),
      );
    expect(await codeOf(downloadWebstoreCrx(ID, { fetcher: endless, maxBytes: 10_000 }))).toBe(
      'too_large',
    );
    expect(pulled).toBeLessThan(50);
  });

  it('gives up on a body that stalls', async () => {
    vi.useFakeTimers();
    try {
      const stalled: Fetcher = async (_url, { signal }) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              signal.addEventListener('abort', () => controller.error(new Error('aborted')));
            },
          }),
        );
      const pending = codeOf(downloadWebstoreCrx(ID, { fetcher: stalled }));
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await pending).toBe('download_failed');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('checkWebstoreUpdate', () => {
  it('asks about the installed version and reads the verdict', async () => {
    const fetcher = vi.fn(
      respond(gupdate(`<app appid="${ID}" status="ok"><updatecheck status="noupdate"/></app>`)),
    );
    expect(await checkWebstoreUpdate(ID, '1.0', fetcher)).toEqual({ status: 'noupdate' });
    expect(fetcher).toHaveBeenCalledWith(updateCheckUrl(ID, '1.0'), expect.anything());
  });

  it('fails on an answer it cannot read or a bad status', async () => {
    expect(await codeOf(checkWebstoreUpdate(ID, '1.0', respond('<html/>')))).toBe(
      'download_failed',
    );
    expect(await codeOf(checkWebstoreUpdate(ID, '1.0', respond('x', { status: 500 })))).toBe(
      'download_failed',
    );
  });
});

describe('isNewer', () => {
  it('compares numerically, part by part', () => {
    expect(isNewer('1.10', '1.9')).toBe(true);
    expect(isNewer('2.12.1', '2.12.1')).toBe(false);
    expect(isNewer('2.12', '2.12.0')).toBe(false);
    expect(isNewer('2.12.0.1', '2.12')).toBe(true);
    expect(isNewer('1.0', '1.0.1')).toBe(false);
  });
});
