import { useCallback, useEffect, useRef, useState } from 'react';
import loadingVideo from '~/assets/loading.webm';
import s from './Splash.module.scss';

interface SplashProps {
  onDone: () => void;
}

// Safety cap so a video that never fires `ended` (decode failure, missing codec)
// can't trap the user on the splash forever.
const MAX_DURATION = 8000;

export const Splash = ({ onDone }: SplashProps) => {
  const [leaving, setLeaving] = useState(false);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setLeaving(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(finish, MAX_DURATION);
    return () => window.clearTimeout(timer);
  }, [finish]);

  return (
    <div
      className={`${s.splash} ${leaving ? s.hidden : ''}`}
      onTransitionEnd={() => leaving && onDone()}
    >
      <video
        className={s.video}
        src={loadingVideo}
        autoPlay
        muted
        playsInline
        onEnded={finish}
        onError={finish}
      />
    </div>
  );
};
