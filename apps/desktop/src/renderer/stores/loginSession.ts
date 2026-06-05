import type { LoginStep } from '@adapter-contract';
import { create } from 'zustand';

export type LoginService = 'steam' | 'telegram' | 'browser' | 'discord';

interface LoginSessionState {
  itemId: number | null;
  accountTitle: string;
  service: LoginService | null;
  step: LoginStep | null;
  detail: string | undefined;
  error: string | null;
  isOpen: boolean;
  start: (itemId: number, title: string, service: LoginService) => void;
  setStep: (step: LoginStep, detail?: string) => void;
  fail: (error: string) => void;
  close: () => void;
}

export const useLoginSession = create<LoginSessionState>((set) => ({
  itemId: null,
  accountTitle: '',
  service: null,
  step: null,
  detail: undefined,
  error: null,
  isOpen: false,
  start: (itemId, title, service) =>
    set({
      itemId,
      accountTitle: title,
      service,
      step: 'fetching-credentials',
      detail: undefined,
      error: null,
      isOpen: true,
    }),
  setStep: (step, detail) => set({ step, detail }),
  fail: (error) => set({ error }),
  close: () =>
    set({
      itemId: null,
      accountTitle: '',
      service: null,
      step: null,
      detail: undefined,
      error: null,
      isOpen: false,
    }),
}));
