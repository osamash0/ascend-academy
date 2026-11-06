import { Navigate, useParams } from 'react-router-dom';
import LandingScreen from '../landing/LandingScreen';

/**
 * Adapts the route to the door, which stays route-agnostic (as `SpaceRoute` does for the Space).
 * Keyed by the Space id: `useLanding` is not, so without the key the previous
 * Space's landing would show for a frame under the new id.
 */
export default function LandingRoute() {
  const { spaceId } = useParams<{ spaceId: string }>();
  return spaceId ? <LandingScreen key={spaceId} spaceId={spaceId} /> : <Navigate replace to="/v4/spaces" />;
}
