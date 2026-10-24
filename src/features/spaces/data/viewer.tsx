import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { viewer as demoViewer } from '../mocks/people';
import type { Person } from '../types';
import { SpacesError } from '../components/states';
import { dataMode, loadLiveRepository } from './liveRepository';
import { setLiveWorld } from './world';

/**
 * Who is looking — the one person every screen calls "you" — and the world
 * they look at.
 *
 * Screens read the viewer with `useViewer()`, synchronously, exactly as they
 * used to read the `viewer` constant. In demo mode the context's default *is*
 * that constant and `world.ts` answers from the fixtures, so a screen rendered
 * without a provider (tests, `?mock=`) is unchanged.
 *
 * In live mode `LiveGate` loads the viewer's world once, at the root of v4,
 * before any screen renders — so no screen has to handle "the viewer is still
 * loading", and `spaceById(id)` can stay a synchronous question.
 */
const ViewerContext = createContext<Person>(demoViewer);

/**
 * Reload the world after something changed it on the server (joining a
 * Space). The v4 tree is remounted on the new world: screens read it
 * synchronously, so a fresh mount is the one way every one of them sees it.
 * A no-op in demo mode.
 */
const RefreshContext = createContext<() => Promise<void>>(async () => {});

export function useViewer(): Person {
  return useContext(ViewerContext);
}

export function useRefreshWorld(): () => Promise<void> {
  return useContext(RefreshContext);
}

export function LiveGate({ children }: { children: ReactNode }) {
  const live = dataMode(import.meta.env.VITE_V4_DATA_MODE) === 'live';
  const [person, setPerson] = useState<Person | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  const fetchWorld = useCallback(async () => {
    const world = await (await loadLiveRepository()).world();
    setLiveWorld(world);
    setPerson(world.viewer);
  }, []);

  const load = useCallback(() => {
    setFailed(false);
    fetchWorld().catch(() => setFailed(true));
  }, [fetchWorld]);

  const refresh = useCallback(async () => {
    await fetchWorld();
    setVersion((v) => v + 1);
  }, [fetchWorld]);

  useEffect(() => {
    if (!live) return;
    load();
    // Leaving v4 drops the cached world; coming back loads it fresh.
    return () => setLiveWorld(null);
  }, [live, load]);

  if (!live) return <>{children}</>;
  if (failed) return <SpacesError what="spaces" onRetry={load} />;
  // A blank stage for the one round-trip: the screens' own skeletons follow.
  if (!person) return null;
  return (
    <ViewerContext.Provider value={person}>
      <RefreshContext.Provider value={refresh}>
        <Fragment key={version}>{children}</Fragment>
      </RefreshContext.Provider>
    </ViewerContext.Provider>
  );
}
