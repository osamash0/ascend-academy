import { useParams } from 'react-router-dom';
import SpaceScreen, { type SpaceTab } from './SpaceScreen';
import CourseScreen from './CourseScreen';
import RehearsalScreen from './RehearsalScreen';
import JoinSpaceScreen from './JoinSpaceScreen';
import { isLive } from '../data/useReader';
import { spaceById } from '../data/world';

const TABS: SpaceTab[] = ['overview', 'map', 'members'];

/**
 * Adapts the route to the screen, which stays route-agnostic.
 *
 * The tab is a URL segment rather than local state, so every tab is
 * shareable, back-button-able and deep-linkable — Doc 2 requires every key
 * screen to be reachable by URL. An unknown segment falls back to Overview
 * rather than rendering an empty screen.
 */
export default function SpaceRoute() {
  const { spaceId, tab } = useParams<{ spaceId: string; tab?: string }>();
  const active = TABS.includes(tab as SpaceTab) ? (tab as SpaceTab) : 'overview';
  // A real course (live mode, a UUID) is read as a journey through its lectures —
  // once you are in it. Until then it shows what is inside, and a way in.
  if (spaceId && isLive(spaceId)) {
    if (spaceById(spaceId)?.viewerRole === null) return <JoinSpaceScreen spaceId={spaceId} />;
    return tab === 'rehearse' ? <RehearsalScreen courseId={spaceId} /> : <CourseScreen courseId={spaceId} />;
  }
  return <SpaceScreen spaceId={spaceId} tab={active} />;
}
