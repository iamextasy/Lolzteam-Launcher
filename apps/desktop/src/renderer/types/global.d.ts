import type { LauncherApi } from '../../preload';

declare global {
  interface Window {
    launcher: LauncherApi;
  }
}
