import { createCipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const PS_UNPROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$dataB64 = [Console]::In.ReadLine()
$data = [Convert]::FromBase64String($dataB64)
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$result = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $null, $scope)
[Console]::Out.WriteLine([Convert]::ToBase64String($result))
`;

const encodeForPowerShell = (script: string): string =>
  Buffer.from(script, "utf16le").toString("base64");

function dpapiUnprotect(encryptedBuf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("DPAPI is only available on Windows"));
      return;
    }

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encodeForPowerShell(PS_UNPROTECT),
      ],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("DPAPI unprotect timed out"));
        return;
      }

      if (code !== 0) {
        reject(new Error(`DPAPI unprotect failed (${code}): ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.from(stdout.trim(), "base64"));
    });

    child.stdin.write(`${encryptedBuf.toString("base64")}\n`);
    child.stdin.end();
  });
}

export async function readCefAesKey(localPrefsPath: string): Promise<Buffer> {
  const raw = await readFile(localPrefsPath, "utf8");
  const prefs = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
  const encryptedKeyB64 = prefs.os_crypt?.encrypted_key;
  if (!encryptedKeyB64)
    throw new Error("os_crypt.encrypted_key not found in LocalPrefs.json");

  // Chromium stores the master key as base64("DPAPI" + <dpapi_blob>); strip the 5-byte prefix.
  const dpapiBuf = Buffer.from(encryptedKeyB64, "base64").slice(5);
  return dpapiUnprotect(dpapiBuf);
}

function encryptChromiumCookie(aesKey: Buffer, value: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v10"), nonce, encrypted, authTag]);
}

// Chromium stores timestamps as microseconds since 1601-01-01 (Windows epoch).
const CHROMIUM_EPOCH_OFFSET_US = BigInt(11644473600) * BigInt(1_000_000);

const nowChromiumMicros = (): bigint =>
  BigInt(Date.now()) * BigInt(1000) + CHROMIUM_EPOCH_OFFSET_US;

const twoYearsFromNowChromiumMicros = (): bigint =>
  nowChromiumMicros() + BigInt(2 * 365 * 24 * 3600) * BigInt(1_000_000);

export function writeCefCookies(
  cookiesDbPath: string,
  aesKey: Buffer,
  cookies: { remid: string; sid?: string }
): void {
  const db = new Database(cookiesDbPath);

  try {
    db.pragma("journal_mode = WAL");

    const upsert = db.prepare(`
      INSERT INTO cookies
        (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value,
         path, expires_utc, is_secure, is_httponly, last_access_utc,
         has_expires, is_persistent, priority, samesite, source_scheme,
         source_port, is_same_party, last_update_utc)
      VALUES
        (@creation_utc, @host_key, '', @name, '', @encrypted_value,
         @path, @expires_utc, 1, 1, @creation_utc,
         1, 1, 1, -1, 2, 443, 0, @creation_utc)
      ON CONFLICT(top_frame_site_key, host_key, name, path)
      DO UPDATE SET
        encrypted_value = excluded.encrypted_value,
        expires_utc     = excluded.expires_utc,
        last_update_utc = excluded.last_update_utc,
        value           = ''
    `);

    const now = nowChromiumMicros();
    const expires = twoYearsFromNowChromiumMicros();

    const entries: Array<{
      name: string;
      value: string;
      path: string;
      host: string;
    }> = [
      {
        name: "remid",
        value: cookies.remid,
        path: "/connect",
        host: ".ea.com",
      },
    ];

    if (cookies.sid) {
      entries.push({
        name: "sid",
        value: cookies.sid,
        path: "/connect",
        host: ".ea.com",
      });
    }

    const writeAll = db.transaction(() => {
      for (const entry of entries) {
        upsert.run({
          creation_utc: now.toString(),
          host_key: entry.host,
          name: entry.name,
          encrypted_value: encryptChromiumCookie(aesKey, entry.value),
          path: entry.path,
          expires_utc: expires.toString(),
        });
      }
    });

    writeAll();
  } finally {
    db.close();
  }
}
