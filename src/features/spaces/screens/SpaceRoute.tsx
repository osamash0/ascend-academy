import { useParams } from 'react-router-dom';
import SpaceScreen from './SpaceScreen';

/** Adapts the route param to the screen, which stays route-agnostic. */
export default function SpaceRoute() {
  const { spaceId } = useParams<{ spaceId: string }>();
  return <SpaceScreen spaceId={spaceId} />;
}
