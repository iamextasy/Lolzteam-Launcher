import type { LauncherSettings } from '@shared-types';
import { create } from 'zustand';

interface SettingsState {
  settings: LauncherSettings | null;
  set: (settings: LauncherSettings) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  set: (settings) => set({ settings }),
}));

let started = false;

export const initSettingsStore = (): void => {
  if (started) return;
  started = true;
  void window.launcher.settings.get().then((next) => useSettings.getState().set(next.settings));
  window.launcher.settings.onChanged((next) => useSettings.getState().set(next.settings));
};
