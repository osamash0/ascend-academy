// LearnStation Luna — React Hook for Moon Phase Preference
// Stores user preference in localStorage, syncs with Supabase if available

import { useState, useEffect, useCallback } from 'react';
import type { MoonPhase } from '../types/luna';

const STORAGE_KEY = 'learnstation-luna-phase';

export function useLunaPhase(defaultPhase: MoonPhase = 'full') {
  const [phase, setPhaseState] = useState<MoonPhase | number>(() => {
    if (typeof window === 'undefined') return defaultPhase;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const num = parseInt(saved, 10);
      if (!isNaN(num)) return num;
      return saved as MoonPhase;
    }
    return defaultPhase;
  });

  const setPhase = useCallback((newPhase: MoonPhase | number) => {
    setPhaseState(newPhase);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(newPhase));
    }
  }, []);

  // Optional: sync with system dark mode
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if user hasn't manually set a preference
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        setPhaseState(e.matches ? 'dark' : 'full');
      }
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return { phase, setPhase };
}

export default useLunaPhase;
