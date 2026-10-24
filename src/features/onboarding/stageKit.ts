import { useEffect, useState } from 'react';

/** Luna at hero size, never crowding a phone — the rule Home uses. */
export function useLunaSize(phone: number, desktop: number) {
  const pick = () => (typeof window !== 'undefined' && window.innerWidth < 640 ? phone : desktop);
  const [size, setSize] = useState(pick);
  useEffect(() => {
    const on = () => setSize(pick());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, desktop]);
  return size;
}

/** Inputs on the stage: quiet glass, white focus ring, no icon clutter. */
export const stageInput =
  'h-12 w-full rounded-2xl border border-white/12 bg-white/[0.05] px-4 text-[15px] text-white placeholder:text-white/35 outline-none transition-colors focus:border-white/40 focus:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-white/30 aria-[invalid=true]:border-rose-300/60';
