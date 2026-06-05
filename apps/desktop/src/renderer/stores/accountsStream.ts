import type { AccountSummary, ServiceId } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useAccountsLoading } from './accountsLoading';

export const STREAM_SERVICES = [
  'steam',
  'telegram',
  'tiktok',
  'instagram',
  'discord',
] as const satisfies readonly ServiceId[];
export type StreamService = (typeof STREAM_SERVICES)[number];

export const isStreamService = (id: ServiceId | null): id is StreamService =>
  id !== null && (STREAM_SERVICES as readonly string[]).includes(id);

export interface StreamProgress {
  service: StreamService;
  page: number;
  totalPages: number | null;
  count: number;
}

interface AccountsStreamState {
  streaming: boolean;
  loaded: ReadonlySet<StreamService>;
  streamed: Map<StreamService, AccountSummary[]>;
  progress: StreamProgress | null;
  setStreaming: (streaming: boolean) => void;
  setLoaded: (updater: (prev: ReadonlySet<StreamService>) => ReadonlySet<StreamService>) => void;
  setProgress: (progress: StreamProgress | null) => void;
  resetAccumulator: () => void;
  reset: () => void;
}

export const useAccountsStream = create<AccountsStreamState>((set) => ({
  streaming: false,
  loaded: new Set(),
  streamed: new Map(),
  progress: null,
  setStreaming: (streaming) => set({ streaming }),
  setLoaded: (updater) => set((s) => ({ loaded: updater(s.loaded) })),
  setProgress: (progress) => set({ progress }),
  resetAccumulator: () => set({ streamed: new Map() }),
  reset: () => set({ streaming: false, loaded: new Set(), streamed: new Map(), progress: null }),
}));

export const mergeWithStream = (base: AccountSummary[]): AccountSummary[] => {
  const touched = useAccountsStream.getState().streamed;
  const kept = base.filter((it) => !(isStreamService(it.category) && touched.has(it.category)));
  return [...kept, ...[...touched.values()].flat()];
};

export const startAccountsStream = (only?: StreamService) => {
  const st = useAccountsStream.getState();
  if (st.streaming) return;
  st.setStreaming(true);
  st.setProgress(null);
  if (only) {
    st.setLoaded((prev) => {
      const next = new Set(prev);
      next.delete(only);
      return next;
    });
    st.streamed.delete(only);
  } else {
    st.setLoaded(() => new Set());
    st.resetAccumulator();
  }
  void window.launcher.accounts.listStream(only).catch(() => st.setStreaming(false));
};

export const useAccountsStreamController = () => {
  const qc = useQueryClient();

  useEffect(() => {
    const rebuild = () =>
      qc.setQueryData<AccountSummary[]>(['accounts'], (prev) => mergeWithStream(prev ?? []));

    const off = window.launcher.accounts.onCategory(
      ({ serviceId, items, categoryDone, done, page, totalPages }) => {
        const st = useAccountsStream.getState();
        if (isStreamService(serviceId) && items.length > 0) {
          const acc = st.streamed.get(serviceId) ?? [];
          acc.push(...items);
          st.streamed.set(serviceId, acc);
          rebuild();
        }
        if (isStreamService(serviceId) && !categoryDone && page !== undefined) {
          st.setProgress({
            service: serviceId,
            page,
            totalPages: totalPages ?? null,
            count: (st.streamed.get(serviceId) ?? []).length,
          });
        }
        if (categoryDone && isStreamService(serviceId)) {
          if (!st.streamed.has(serviceId)) {
            st.streamed.set(serviceId, []);
            rebuild();
          }
          st.setLoaded((prev) => new Set(prev).add(serviceId));
        }
        if (done) {
          st.setStreaming(false);
          st.setProgress(null);
        }
      },
    );

    let cancelled = false;
    void window.launcher.accounts.list().then((cached) => {
      if (cancelled) return;
      if (cached.length > 0) {
        useAccountsStream.getState().setLoaded(() => new Set(STREAM_SERVICES));
      } else {
        startAccountsStream();
      }
    });

    return () => {
      cancelled = true;
      off();
    };
  }, [qc]);

  const streaming = useAccountsStream((st) => st.streaming);
  useEffect(() => {
    useAccountsLoading.getState().setLoading(streaming);
    return () => useAccountsLoading.getState().setLoading(false);
  }, [streaming]);
};
