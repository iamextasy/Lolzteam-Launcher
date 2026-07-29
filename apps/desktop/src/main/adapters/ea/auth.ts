import { createHash, createHmac, randomBytes } from "node:crypto";
import { net, session as electronSession } from "electron";

const JUNO_CLIENT_ID = "JUNO_PC_CLIENT";
const JUNO_CLIENT_SECRET = "GaBtAGdsB4foH4oRGzwGEiDgCTCexkH1";
const REDIRECT_URI = "qrc:///html/login_successful.html";
const TOKEN_URL = "https://accounts.ea.com/connect/token";

const EA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Origin/10.6.0.00000 EAApp/13.735.2.6250 Chrome/109.0.5414.120 Safari/537.36";

const CID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";

function pick<T>(arr: readonly T[]): T {
  return arr[randomBytes(1)[0]! % arr.length]!;
}

function eaRandomString(len = 32): string {
  let s = "";
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i++)
    s += CID_ALPHABET[bytes[i]! % CID_ALPHABET.length];
  return s;
}

function generateCid(): string {
  return `${eaRandomString()},${eaRandomString()}`;
}

function generatePbd(emailStep: boolean): string {
  const mms = 1000 + Math.floor(Math.random() * 1000);
  return Buffer.from(
    JSON.stringify({
      mms,
      mmpa: mms * 10 + Math.floor(Math.random() * 5000),
      mmna: -(mms * 8 + Math.floor(Math.random() * 3000)),
      msr: 0.7 + Math.random() * 0.25,
      tm: emailStep ? 350 + Math.random() * 150 : 100 + Math.random() * 80,
      mt: emailStep ? 1.0 + Math.random() * 0.2 : 0.6 + Math.random() * 0.2,
      pt: emailStep ? 2.5 + Math.random() * 1.5 : 0,
      wpm: emailStep ? 15 + Math.random() * 10 : 20 + Math.random() * 10,
      ati: emailStep
        ? 600 + Math.floor(Math.random() * 100)
        : 480 + Math.floor(Math.random() * 80),
      cpc: 1,
      tvmc: emailStep ? 1 : 0,
      tvtc: 0,
      tvkc: 0,
      tvac: 0,
      lcm: 0,
      lcl: 0,
      uwd: false,
      icn: false,
      ihff: false,
    })
  ).toString("base64");
}

function generatePbdt(emailStep: boolean): string {
  return Buffer.from(
    JSON.stringify({
      ini: emailStep ? 0.8 + Math.random() * 0.1 : 0.7 + Math.random() * 0.1,
      mm: emailStep ? 2.5 + Math.random() * 1.0 : 1.2 + Math.random() * 0.3,
      sm: emailStep ? 0.7 + Math.random() * 0.1 : 0.5,
    })
  ).toString("base64");
}

const SCREEN_RESOLUTIONS = [
  "1920x1080",
  "2560x1440",
  "1920x1200",
  "2560x1080",
  "1680x1050",
] as const;

const HW_CONCURRENCIES = [4, 8, 12, 16, 24] as const;
const DEVICE_MEMORIES = [4, 8, 16] as const;
const TIMEZONES: readonly [tz: string, to: number][] = [
  ["America/New_York", 300],
  ["America/Chicago", 360],
  ["America/Los_Angeles", 480],
  ["Europe/London", 0],
  ["Europe/Paris", -60],
  ["Europe/Berlin", -60],
  ["Europe/Moscow", -180],
  ["Asia/Kolkata", -330],
  ["Asia/Shanghai", -480],
  ["Asia/Tokyo", -540],
];

function generateDf(): string {
  const [tz, to] = pick(TIMEZONES);
  return Buffer.from(
    JSON.stringify({
      cd: 24,
      sr: pick(SCREEN_RESOLUTIONS),
      tz,
      ua: createHash("md5").update(EA_UA).digest("hex"),
      hc: pick(HW_CONCURRENCIES),
      dm: pick(DEVICE_MEMORIES),
      cf: "64aec8d0773699914eeb9aa71fb39640",
      wf: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)",
      af: "d41d8cd98f00b204e9800998ecf8427e",
      pg: "c0f48806e2dc75d6fcbd91de7957bb6f",
      ts: false,
      ct: "4g",
      to,
      cs: true,
      dnt: null,
      lg: "en-US",
    })
  ).toString("base64");
}

function generateDft(emailStep: boolean): string {
  return Buffer.from(
    JSON.stringify({
      overall: emailStep
        ? 7.0 + Math.random() * 1.0
        : 6.0 + Math.random() * 0.8,
      cft: 2.5 + Math.random() * 0.5,
      wft: 3.3 + Math.random() * 0.4,
      aft: 4.1 + Math.random() * 0.4,
      pgt: emailStep ? 0 : 0.08 + Math.random() * 0.05,
    })
  ).toString("base64");
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const PC_SIGN_KEYS = {
  v1: "ISa3dpGOc8wW7Adn4auACSQmaccrOyR2",
  v2: "nt5FfJbdPzNcl2pkC3zgjO43Knvscxft",
} as const;

function utcTimestamp(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} ` +
    `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}:${d.getUTCMilliseconds()}`
  );
}

function generatePcSign(): string {
  const sv = Math.random() > 0.5 ? "v1" : "v2";
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        av: "v1",
        bsn: "Default string",
        gid: randomBytes(2).readUInt16BE(0) & 0x7fff,
        hsn: "Default string",
        mac: "$" + randomBytes(6).toString("hex"),
        mid: (
          BigInt("0x" + randomBytes(8).toString("hex")) &
          BigInt("0xFFFFFFFFFFFFFFFF")
        ).toString(10),
        msn: "Default string",
        sv,
        ts: utcTimestamp(),
      })
    )
  );
  const sig = base64url(
    createHmac("sha256", PC_SIGN_KEYS[sv]).update(payload).digest()
  );
  return `${payload}.${sig}`;
}

const NAV_HEADERS = {
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
} as const;

type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  sess: Electron.Session;
  signal?: AbortSignal;
};

// Uses Chromium's network stack (matching EA Desktop's TLS fingerprint) with an
// isolated session so Set-Cookie headers from redirects are stored and replayed
// automatically — we never need to track cookies manually.
function chromiumFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  sess: Electron.Session,
  body?: string,
  signal?: AbortSignal
): Promise<{
  status: number;
  responseHeaders: Record<string, string | string[]>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const req = net.request({
      url,
      method,
      redirect: "manual",
      session: sess,
      useSessionCookies: true,
    });

    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "cookie") continue;
      req.setHeader(k, v);
    }

    let settled = false;
    const done = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const onAbort = () => {
      req.abort();
      done(() => reject(new DOMException("Aborted", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    req.on("redirect", (statusCode, _method, _redirectUrl, responseHeaders) => {
      const flat: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(responseHeaders))
        flat[k.toLowerCase()] = v;
      done(() =>
        resolve({ status: statusCode, responseHeaders: flat, body: "" })
      );
      signal?.removeEventListener("abort", onAbort);
    });

    req.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const flat: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(response.headers))
          flat[k.toLowerCase()] = v;
        done(() =>
          resolve({
            status: response.statusCode,
            responseHeaders: flat,
            body: Buffer.concat(chunks).toString("utf-8"),
          })
        );
        signal?.removeEventListener("abort", onAbort);
      });
      response.on("error", (err: Error) => {
        done(() => reject(err));
        signal?.removeEventListener("abort", onAbort);
      });
    });

    req.on("error", (err: Error) => {
      done(() => reject(err));
      signal?.removeEventListener("abort", onAbort);
    });

    if (body) req.write(body);
    req.end();
  });
}

function buildHeaders(raw: Record<string, string | string[]>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      for (const s of v) h.append(k, s);
    } else {
      h.set(k, v);
    }
  }
  return h;
}

async function doFetch(
  url: string,
  opts: FetchOptions
): Promise<{
  status: number;
  headers: Headers;
  text: string;
  location: string | null;
}> {
  const reqHeaders: Record<string, string> = {
    "User-Agent": EA_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    ...opts.headers,
  };

  const raw = await chromiumFetch(
    url,
    opts.method ?? "GET",
    reqHeaders,
    opts.sess,
    opts.body,
    opts.signal
  );
  const headers = buildHeaders(raw.responseHeaders);
  const location =
    (Array.isArray(raw.responseHeaders["location"])
      ? raw.responseHeaders["location"][0]
      : (raw.responseHeaders["location"] as string | undefined)) ?? null;

  return { status: raw.status, headers, text: raw.body, location };
}

async function followRedirects(
  startUrl: string,
  sess: Electron.Session,
  signal: AbortSignal | undefined,
  maxHops = 10
): Promise<{
  currentUrl: string;
  text: string;
  status: number;
  location: string | null;
  headers: Headers;
}> {
  let currentUrl = startUrl;
  let r = await doFetch(currentUrl, { sess, signal });

  for (
    let i = 0;
    i < maxHops && r.status >= 300 && r.status < 400 && r.location;
    i++
  ) {
    const next = new URL(r.location, currentUrl).toString();
    if (next.startsWith("qrc:")) {
      currentUrl = next;
      break;
    }
    currentUrl = next;
    r = await doFetch(currentUrl, { sess, signal });
  }

  return { currentUrl, ...r };
}

export type EaErrorCode =
  | "bad-credentials"
  | "needs-2fa"
  | "bad-2fa-code"
  | "no-remid"
  | "unknown";

export interface EaSession {
  remid: string;
  sid?: string;
}

export class EaLoginError extends Error {
  constructor(message: string, public readonly code: EaErrorCode = "unknown") {
    super(message);
    this.name = "EaLoginError";
  }
}

export async function performEaLogin(
  email: string,
  password: string,
  fetchEmailCode?: () => Promise<string | null>,
  signal?: AbortSignal
): Promise<EaSession> {
  const loginPartition = `partition:ea-login-${Date.now()}-${Math.floor(
    Math.random() * 1e9
  )}`;
  const sess = electronSession.fromPartition(loginPartition, { cache: false });

  const f = (url: string, opts: Omit<FetchOptions, "sess">) =>
    doFetch(url, { ...opts, sess, signal });

  const { verifier, challenge } = generatePkce();
  const pcSign = generatePcSign();

  const authUrl = new URL("https://accounts.ea.com/connect/auth");
  authUrl.searchParams.set("client_id", JUNO_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("locale", "en_US");
  authUrl.searchParams.set("sbiod_enabled", "true");
  authUrl.searchParams.set("display", "junoClient/login");
  authUrl.searchParams.set("pc_sign", pcSign);
  authUrl.searchParams.set(
    "nonce",
    String(Math.floor(Math.random() * 2147483647))
  );

  let { currentUrl } = await followRedirects(authUrl.toString(), sess, signal);

  if (currentUrl.startsWith("qrc:")) {
    const errUrl = new URL(currentUrl.replace(/^qrc:/, "http://ea"));
    const errCode = errUrl.searchParams.get("error_code") ?? "";
    const errDesc =
      errUrl.searchParams.get("error_description") ??
      errUrl.searchParams.get("error") ??
      "unknown";
    throw new EaLoginError(
      `EA OAuth error (${errCode}): ${errDesc}`,
      errCode === "110003" ? "bad-credentials" : "unknown"
    );
  }

  const execution = new URL(currentUrl).searchParams.get("execution") ?? "";
  if (!execution)
    throw new EaLoginError(
      `No execution token in login URL: ${currentUrl}`,
      "unknown"
    );

  const df = generateDf();

  let r = await f(currentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "max-age=0",
      Origin: "https://signin.ea.com",
      Referer: currentUrl,
      ...NAV_HEADERS,
    },
    body: new URLSearchParams({
      verification: "",
      email,
      _eventId: "submit",
      cid: "",
      showAgeUp: "true",
      loginMethod: "emailPassword",
      passkeyAssertionResponse: "",
      passkeySupportStatus: "supported",
      _rememberMe: "on",
      rememberMe: "on",
      _loginInvisible: "on",
      pbd: generatePbd(true),
      pbdt: generatePbdt(true),
      pbde: "",
      df,
      dft: generateDft(true),
      dfe: "",
    }).toString(),
  });

  const prevUrl = currentUrl;
  for (
    let i = 0;
    i < 5 && r.status >= 300 && r.status < 400 && r.location;
    i++
  ) {
    currentUrl = new URL(r.location, currentUrl).toString();
    r = await f(currentUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "max-age=0",
        Referer: prevUrl,
        ...NAV_HEADERS,
      },
    });
  }

  if (
    r.status === 200 &&
    (r.text.includes("incorrectPasswordError") || r.text.includes("authError"))
  ) {
    throw new EaLoginError("Bad email or password", "bad-credentials");
  }

  const cid = generateCid();

  r = await f(currentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "max-age=0",
      Origin: "https://signin.ea.com",
      Referer: currentUrl,
      ...NAV_HEADERS,
    },
    body: new URLSearchParams({
      verification: "",
      password,
      _eventId: "submit",
      cid,
      showAgeUp: "true",
      thirdPartyCaptchaResponse: "",
      loginMethod: "emailPassword",
      pbd: generatePbd(false),
      pbdt: generatePbdt(false),
      pbde: "",
      df,
      dft: generateDft(false),
      dfe: "",
    }).toString(),
  });

  if (
    r.status === 200 &&
    (r.text.includes("incorrectPasswordError") || r.text.includes("authError"))
  ) {
    throw new EaLoginError("Bad email or password", "bad-credentials");
  }

  for (
    let i = 0;
    i < 5 && r.status >= 300 && r.status < 400 && r.location;
    i++
  ) {
    const next = new URL(r.location, currentUrl).toString();
    if (next.startsWith("qrc:")) break;
    currentUrl = next;
    r = await f(currentUrl, {
      method: "GET",
      headers: {
        Referer: "https://signin.ea.com/",
        ...NAV_HEADERS,
      },
    });
  }

  if (r.status === 200 && r.text.includes("dynamicchallenge/sendCode")) {
    if (!fetchEmailCode) {
      throw new EaLoginError(
        "2FA required but no email code fetcher provided",
        "needs-2fa"
      );
    }

    const sendCodeUrl = currentUrl;
    r = await f(sendCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "max-age=0",
        Origin: "https://signin.ea.com",
        Referer: sendCodeUrl,
        ...NAV_HEADERS,
      },
      body: new URLSearchParams({
        verification: "",
        codeType: "EMAIL",
        _codeType: "EMAIL",
        _eventId: "submit",
        pbd: generatePbd(false),
        pbdt: generatePbdt(false),
        pbde: "",
        df,
        dft: generateDft(false),
        dfe: "",
      }).toString(),
    });

    for (
      let i = 0;
      i < 5 && r.status >= 300 && r.status < 400 && r.location;
      i++
    ) {
      const next = new URL(r.location, currentUrl).toString();
      if (next.startsWith("qrc:")) break;
      currentUrl = next;
      r = await f(currentUrl, {
        method: "GET",
        headers: {
          Referer: sendCodeUrl,
          ...NAV_HEADERS,
        },
      });
    }

    await new Promise((res) => setTimeout(res, 10_000));
    const code = await fetchEmailCode();
    if (!code)
      throw new EaLoginError("Could not retrieve email code", "needs-2fa");

    const verifyUrl = currentUrl;
    r = await f(verifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "max-age=0",
        Origin: "https://signin.ea.com",
        Referer: verifyUrl,
        ...NAV_HEADERS,
      },
      body: new URLSearchParams({
        verification: "",
        oneTimeCode: code,
        _trustThisDevice: "on",
        trustThisDevice: "on",
        _eventId: "submit",
        pbd: generatePbd(false),
        pbdt: generatePbdt(false),
        pbde: "",
        df,
        dft: generateDft(false),
        dfe: "",
      }).toString(),
    });

    // Success returns 200 with a JS redirect; 302 means the code was rejected.
    if (r.status >= 300 && r.status < 400) {
      throw new EaLoginError("2FA code was rejected by EA", "bad-2fa-code");
    }
  }

  for (let pass = 0; pass < 20; pass++) {
    while (r.status >= 300 && r.status < 400 && r.location) {
      if (r.location.startsWith("qrc:")) break;
      currentUrl = new URL(r.location, currentUrl).toString();
      r = await f(currentUrl, { method: "GET" });
    }

    if (r.location?.startsWith("qrc:")) break;
    if (r.status !== 200) break;

    const jsRedirectRe =
      /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']|window\.location\.(?:assign|replace)\(\s*["']([^"']+)["']\s*\)/;
    const jsMatch = r.text.match(jsRedirectRe);
    if (jsMatch) {
      const jsUrl = jsMatch[1] ?? jsMatch[2]!;
      currentUrl = new URL(jsUrl, currentUrl).toString();
      r = await f(currentUrl, { method: "GET" });
      continue;
    }

    const metaMatch = r.text.match(
      /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>\s]+)/i
    );

    if (metaMatch) {
      currentUrl = new URL(metaMatch[1]!, currentUrl).toString();
      r = await f(currentUrl, { method: "GET" });
      continue;
    }

    break;
  }

  const eaCookies = await sess.cookies.get({ domain: ".ea.com" });
  const remid = eaCookies.find((c) => c.name === "remid")?.value;
  const sid = eaCookies.find((c) => c.name === "sid")?.value;

  sess.clearStorageData().catch(() => {});

  if (!remid)
    throw new EaLoginError("EA did not return remid cookie", "no-remid");

  const codeMatch = r.location?.match(/[?&]code=([^&]+)/);
  if (codeMatch) {
    await f(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: codeMatch[1]!,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: verifier,
        client_id: JUNO_CLIENT_ID,
        client_secret: JUNO_CLIENT_SECRET,
      }).toString(),
    }).catch(() => {});
  }

  return { remid, sid };
}
