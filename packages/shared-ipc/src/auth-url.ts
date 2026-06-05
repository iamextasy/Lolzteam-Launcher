export interface ParsedAuthCallback {
  accessToken: string | null;
  state: string | null;
  expiresIn: number | null;
  tokenType: string | null;
  error: string | null;
  errorDescription: string | null;
}

/**
 * Parse an OAuth callback URL. Supports both query-string (`?access_token=...`)
 * and fragment (`#access_token=...`) responses, which lzt.market uses for the
 * implicit `response_type=token` flow.
 */
export const parseAuthCallback = (raw: string): ParsedAuthCallback => {
  const empty: ParsedAuthCallback = {
    accessToken: null,
    state: null,
    expiresIn: null,
    tokenType: null,
    error: null,
    errorDescription: null,
  };

  let urlObj: URL;
  try {
    urlObj = new URL(raw);
  } catch {
    return empty;
  }

  const fragmentParams = new URLSearchParams(
    urlObj.hash.startsWith('#') ? urlObj.hash.slice(1) : urlObj.hash,
  );
  const queryParams = urlObj.searchParams;

  const pick = (key: string): string | null => fragmentParams.get(key) ?? queryParams.get(key);

  const expiresInRaw = pick('expires_in');
  const expiresIn = expiresInRaw ? Number.parseInt(expiresInRaw, 10) : null;

  return {
    accessToken: pick('access_token'),
    state: pick('state'),
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
    tokenType: pick('token_type'),
    error: pick('error'),
    errorDescription: pick('error_description'),
  };
};
