import { Scene, SURFACES } from '../components/Scene';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { NotFound } from '../components/states';
import { useViewer } from '../data/viewer';

/**
 * A v4 address that leads nowhere, on the v4 stage (LS-050).
 *
 * A typo used to show the 404 inside the old console, whose menu led into
 * the whole classic student app with its own numbers. Here it stays in the
 * room you were in: the top bar, the bottom nav, and one way home.
 */
export default function NotFoundScreen() {
  const viewer = useViewer();
  return (
    <Scene surface={SURFACES.home} status="progress" motionKey="not-found">
      <SpacesTopBar active="home" viewer={viewer} />
      <NotFound what="screen" back={{ to: '/v4/home', place: 'home' }} />
    </Scene>
  );
}
