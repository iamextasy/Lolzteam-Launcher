import { app, session } from 'electron';
import log from 'electron-log/main';

const isDev = !app.isPackaged;

const PROD_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https://*.lzt.market https://lolz.live https://*.lolz.live https://zelenka.guru https://*.zelenka.guru https://nztcdn.com; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https://*.lzt.market https://*.lolz.live https://*.zelenka.guru; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "frame-ancestors 'none';";

const DEV_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; " +
  "style-src 'self' 'unsafe-inline' http://localhost:*; " +
  "img-src 'self' data: blob: http://localhost:* https://*.lzt.market https://lolz.live https://*.lolz.live https://zelenka.guru https://*.zelenka.guru https://nztcdn.com; " +
  "font-src 'self' data: http://localhost:*; " +
  "connect-src 'self' http://localhost:* ws://localhost:* https://*.lzt.market https://*.lolz.live https://*.zelenka.guru; " +
  "object-src 'none'; " +
  "base-uri 'self';";

export const bootstrap = async (): Promise<void> => {
  app.setAppUserModelId('com.lolzteam.launcher');
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

  const csp = isDev ? DEV_CSP : PROD_CSP;

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  log.info(
    `[boot] electron ${process.versions.electron} node ${process.versions.node} (csp=${isDev ? 'dev' : 'prod'})`,
  );
};
