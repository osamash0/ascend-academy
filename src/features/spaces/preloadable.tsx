import { lazy, useState, type ComponentType } from 'react';

/**
 * A lazy screen that can be fetched ahead of time and, once fetched, renders
 * without suspending.
 *
 * `React.lazy` suspends the first time it renders even when its chunk is
 * already in memory (a resolved promise is still read a tick later), and the
 * app's one Suspense boundary shows the full-screen loader for that tick. A
 * screen preloaded here is rendered directly instead, so a drop in the
 * Library opens the reader with no "Loading…" in between.
 */
export type Preloadable = ComponentType & { preload: () => Promise<unknown> };

export function preloadable(load: () => Promise<{ default: ComponentType }>): Preloadable {
  let loaded: ComponentType | null = null;
  let pending: Promise<{ default: ComponentType }> | null = null;
  const fetchOnce = () =>
    (pending ??= load().then(
      (m) => {
        loaded = m.default;
        return m;
      },
      (e) => {
        pending = null; // a failed fetch may be tried again
        throw e;
      },
    ));
  const Lazy = lazy(fetchOnce);
  function Screen() {
    /* Chosen once per mount: switching from the lazy wrapper to the screen itself would remount it. */
    const [Shown] = useState<ComponentType>(() => loaded ?? Lazy);
    return <Shown />;
  }
  return Object.assign(Screen, { preload: fetchOnce });
}
