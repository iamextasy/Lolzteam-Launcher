import type { UpdateStatus } from '@shared-ipc';
import { create } from 'zustand';

interface UpdaterState {
  status: UpdateStatus | null;
  dismissed: boolean;
  setStatus: (status: UpdateStatus) => void;
  dismiss: () => void;
}

export const useUpdater = create<UpdaterState>((set) => ({
  status: null,
  dismissed: false,
  setStatus: (status) =>
    set((prev) => ({
      status,
      dismissed: status.state === 'available' ? false : prev.dismissed,
    })),
  dismiss: () => set({ dismissed: true }),
}));
