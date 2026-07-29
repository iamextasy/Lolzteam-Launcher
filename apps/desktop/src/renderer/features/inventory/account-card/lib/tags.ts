import type { AccountSummary, AccountTag } from '@shared-types';

// lzt.market tag ids: 1 = valid, 2 = invalid. Matching by id survives title renames.
const VALID_TAG_ID = 1;
const INVALID_TAG_ID = 2;
// Status-driving tags rendered by the header dot, not as chips below the title.
const STATUS_TAG_IDS = new Set([VALID_TAG_ID, INVALID_TAG_ID]);

const EMPTY_TAGS: AccountTag[] = [];

/** Tags live on the summary, but older payloads only carry them per service. */
export const tagsOf = (item: AccountSummary): AccountTag[] =>
  item.tags ?? item.steam?.tags ?? item.telegram?.tags ?? EMPTY_TAGS;

export const isInvalidTags = (tags: AccountTag[]): boolean =>
  tags.some((tag) => tag.id === INVALID_TAG_ID);

export const chipTagsOf = (tags: AccountTag[]): AccountTag[] =>
  tags.filter((tag) => !STATUS_TAG_IDS.has(tag.id) && tag.title.trim() !== '');
