import { useState } from 'react';

/** How many of `total` to show: `first`, then `step` more each time, back to `first` on less. */
export function useStepped(total: number, first: number, step: number) {
  const [shown, setShown] = useState(first);
  const visible = Math.min(shown, total);
  return {
    shown: visible,
    more: visible < total ? () => setShown((s) => s + step) : undefined,
    less: visible > first ? () => setShown(first) : undefined,
  };
}
