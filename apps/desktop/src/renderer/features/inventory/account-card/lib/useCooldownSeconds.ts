import { useEffect, useState } from 'react';

const secondsLeft = (until: number | null): number =>
  until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));

/**
 * Seconds remaining until `until`, ticking once a second. Kept in the component
 * that renders the countdown so the rest of the card doesn't re-render with it.
 */
export const useCooldownSeconds = (until: number | null): number => {
  const [left, setLeft] = useState(() => secondsLeft(until));

  useEffect(() => {
    setLeft(secondsLeft(until));
    if (until === null) return;
    const id = setInterval(() => {
      const next = secondsLeft(until);
      setLeft(next);
      if (next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);

  return left;
};
