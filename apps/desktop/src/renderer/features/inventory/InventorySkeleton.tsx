import s from './InventoryView.module.scss';

export const SkeletonCard = () => (
  <div className={s.skeletonCard}>
    <div className={s.skeletonTop}>
      <div className={s.skeletonHead}>
        <div className={s.skeletonThumb} />
        <div className={`${s.skeletonLine} ${s.skeletonCategory}`} />
      </div>
      <div className={`${s.skeletonLine} ${s.skeletonStatus}`} />
    </div>

    <div className={`${s.skeletonLine} ${s.skeletonTitle}`} />
    <div className={`${s.skeletonLine} ${s.skeletonAbout}`} />

    <div className={s.skeletonBadges}>
      <div className={`${s.skeletonLine} ${s.skeletonBadge}`} />
      <div className={`${s.skeletonLine} ${s.skeletonBadge}`} />
      <div className={`${s.skeletonLine} ${s.skeletonBadge}`} />
    </div>

    <div className={s.skeletonDivider} />

    <div className={s.skeletonBottom}>
      <div className={s.skeletonCol}>
        <div className={`${s.skeletonLine} ${s.skeletonLabel}`} />
        <div className={`${s.skeletonLine} ${s.skeletonValue}`} />
      </div>
      <div className={s.skeletonCol}>
        <div className={`${s.skeletonLine} ${s.skeletonLabel}`} />
        <div className={`${s.skeletonLine} ${s.skeletonValue}`} />
      </div>
    </div>

    <div className={s.skeletonButton} />
  </div>
);
