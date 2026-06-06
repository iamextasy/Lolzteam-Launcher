// Global declarations for renderer environment

import type { LauncherApi } from '../preload';

declare module '*.scss' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.module.scss' {
  const classes: { [key: string]: string };
  export default classes;
}

declare global {
  interface Window {
    launcher: LauncherApi;
  }
  // allow document in node contexts used by renderer build
  const document: Document;
}
