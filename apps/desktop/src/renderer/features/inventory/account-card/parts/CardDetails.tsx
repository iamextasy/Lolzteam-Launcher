import type { AccountSummary } from '@shared-types';
import s from '../AccountCard.module.scss';
import { DETAILS_PANELS } from '../details/registry';

interface CardDetailsProps {
  item: AccountSummary;
}

export const CardDetails = ({ item }: CardDetailsProps) => (
  // The wrapper stays even when no panel renders: it carries the spacing above
  // the card's bottom block.
  <div className={s.parsedInfo}>
    {DETAILS_PANELS.map(({ id, Panel }) => (
      <Panel key={id} item={item} />
    ))}
  </div>
);
