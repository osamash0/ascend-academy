import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import JoinSpaceScreen from './JoinSpaceScreen';
import { isLive } from '../data/useReader';
import { spaceById } from '../data/world';

/**
 * The way into a live Space from any link deeper than the Space itself.
 *
 * A classmate's link points at a Lesson, the reader at a page, or a concept.
 * The reader only serves members, so someone who has not joined got "That
 * Lesson isn't here — the link may be wrong" (or "the connection dropped"),
 * which blames a link that is fine (LS-045). Here they see the Space, the
 * Lesson the link was for, and Join. Joining reloads the world, this gate
 * steps aside, and the same URL — page and all — opens what was shared.
 *
 * A Space the viewer cannot see at all is not in the world, so it still
 * falls through to the screen's own "isn't here".
 */
export default function SpaceMemberGate({ children }: { children: ReactNode }) {
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId?: string }>();
  if (spaceId && isLive(spaceId) && spaceById(spaceId)?.viewerRole === null) {
    return <JoinSpaceScreen spaceId={spaceId} lessonId={lessonId} />;
  }
  return <>{children}</>;
}
