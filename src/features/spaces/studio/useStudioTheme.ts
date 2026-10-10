import { useCallback, useState } from 'react';

export type StudioTheme = 'light' | 'dark';
export const THEME_KEY = 'learnstation:studio-theme';

/** Light by default (spec §3.3). A per-viewer convenience: storage may be blocked, and that is fine. */
export function useStudioTheme(): [StudioTheme, () => void] {
  const [theme, setTheme] = useState<StudioTheme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: StudioTheme = t === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* not remembered — still switched */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
