import { useCallback, useEffect, useState } from 'react';

/** The browser's full screen, as the reader's: a flag that follows Esc too. */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function';
  const [full, setFull] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.();
  }, []);
  return { full, toggle, supported };
}
