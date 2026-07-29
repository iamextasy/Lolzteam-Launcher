import type { AccountSummary, AccountTag } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export type TagsTransform = (tags: AccountTag[]) => AccountTag[];

/**
 * Patches one account's tags inside the cached inventory list, mirroring them
 * onto the per-service copies the card may read from.
 */
export const useAccountTags = (itemId: number): ((transform: TagsTransform) => void) => {
  const qc = useQueryClient();

  return useCallback(
    (transform: TagsTransform) => {
      qc.setQueryData<AccountSummary[]>(['accounts'], (prev) =>
        prev?.map((it) => {
          if (it.itemId !== itemId) return it;
          const tags = transform(it.tags ?? []);
          const next = { ...it, tags };
          if (it.steam) next.steam = { ...it.steam, tags };
          if (it.telegram) next.telegram = { ...it.telegram, tags };
          return next;
        }),
      );
    },
    [qc, itemId],
  );
};
