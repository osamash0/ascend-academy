import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { viewer as demoViewer } from '../mocks/people';
import type { Person } from '../types';
import { SpacesError } from '../components/states';
import { dataMode, loadLiveRepository } from './liveRepository';

/**
 * Who is looking — the one person every screen calls "you".
 *
 * Screens read it with `useViewer()`, synchronously, exactly as they used to
 * read the `viewer` constant. In demo mode the context's default *is* that
 * constant, so a screen rendered without a provider (tests, `?mock=`) is
 * unchanged. In live mode `ViewerGate` resolves the signed-in person once, at
 * the root of v4, before any screen renders — so no screen ever has to handle
 * "the viewer is still loading".
 */
const ViewerContext = createContext<Person>(demoViewer);

export function useViewer(): Person {
  return useContext(ViewerContext);
}

export function ViewerGate({ children }: { children: ReactNode }) {
  const live = dataMode(import.meta.env.VITE_V4_DATA_MODE) === 'live';
  const [person, setPerson] = useState<Person | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadLiveRepository()
      .then((repo) => repo.me())
      .then(setPerson)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (live) load();
  }, [live, load]);

  if (!live) return <>{children}</>;
  if (failed) return <SpacesError what="your profile" onRetry={load} />;
  // A blank stage for the one round-trip: the screens' own skeletons follow.
  if (!person) return null;
  return <ViewerContext.Provider value={person}>{children}</ViewerContext.Provider>;
}
