/**
 * What v4 may ask of the signed-in session, as plain context.
 *
 * The namespace may not touch auth (see boundary.test.ts), but a live v4 has to
 * let you sign out. App fills this from outside the seal (SessionActionsBridge),
 * the same way it fills the viewer's loadout. `null` means there is no session
 * to act on — the demo — and screens say so instead of pretending.
 */
import { createContext, useContext } from 'react';

export interface SessionActions {
  signOut: () => Promise<void>;
}

export const SessionActionsContext = createContext<SessionActions | null>(null);

export function useSessionActions(): SessionActions | null {
  return useContext(SessionActionsContext);
}
