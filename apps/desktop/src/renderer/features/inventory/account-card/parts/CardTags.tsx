import type { AccountTag } from '@shared-types';
import { labelColors } from '~/lib/labelColor';
import { useProfileLabels } from '~/stores/profileLabels';
import s from '../AccountCard.module.scss';
import { chipTagsOf } from '../lib/tags';

interface CardTagsProps {
  tags: AccountTag[];
}

export const CardTags = ({ tags }: CardTagsProps) => {
  // Market tags don't always carry their colour; the user's own labels do.
  const labels = useProfileLabels((p) => p.labels);
  const chips = chipTagsOf(tags);
  if (chips.length === 0) return null;

  return (
    <div className={s.tagsBlock}>
      {chips.map((tag) => {
        const c = labelColors(tag.bc ?? labels.find((l) => l.id === tag.id)?.bc);
        return (
          <div
            key={tag.id}
            className={s.tagsItem}
            style={{ backgroundColor: c.background, color: c.text }}
          >
            {tag.title}
          </div>
        );
      })}
    </div>
  );
};
