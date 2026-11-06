import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isLive } from '../data/useReader';
import { liveWorld, spaceById } from '../data/world';

/**
 * The way into a room only the person who runs a Space may see.
 *
 * How it's landing is the owner's: a member, someone who helps run it, someone
 * who has not joined, or someone the Space is hidden from is taken back to the
 * Space itself, never told the room exists. Your personal Space has no owner's
 * view: it is only you. The server says the same (`assert_space_owner`).
 *
 * The world is loaded before any v4 screen renders, so the answer is
 * synchronous. The demo build passes: its fixtures are a design study. A live
 * build never opens a demo id, so a fixture can never show as a real Space.
 */
export default function SpaceOwnerGate({ children }: { children: ReactNode }) {
  const { spaceId } = useParams<{ spaceId: string }>();
  if (!spaceId) return <Navigate replace to="/v4/spaces" />;
  if (liveWorld() === null) return <>{children}</>;
  const space = isLive(spaceId) ? spaceById(spaceId) : undefined;
  if (space?.viewerRole === 'owner' && !space.personal) return <>{children}</>;
  return <Navigate replace to={`/v4/space/${spaceId}`} />;
}
