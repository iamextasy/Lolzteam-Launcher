export const LOLZ_CONFIG = {
  appName: 'Lolzteam Launcher',
  appId: 'com.lolzteam.launcher',
  protocolScheme: 'lolzteamlauncher',
  webUrl: 'https://lolz.team',
  marketWebUrl: 'https://lzt.market',
  /** Where the OAuth consent page is opened. */
  authWebUrl: 'https://lzt.market',
  marketApiUrl: 'https://api.lzt.market',
  // Forum API — the only `/users/me` that returns avatar URLs.
  forumApiUrl: 'https://api.lolz.team',

  /** Where the anonymous metric goes, and the only host the app talks to that is not lolz. */
  telemetryUrl: 'https://extasy.sh/api/launcher/events',

  clientId: 'tyulsodtmt',
  authRedirectUri: 'lolzteamlauncher://oauth/callback',
  // `basic` grants read access to the user's profile (username, avatar) via /me.
  oauthScopes: 'basic market',
} as const;

export type LolzConfig = typeof LOLZ_CONFIG;
