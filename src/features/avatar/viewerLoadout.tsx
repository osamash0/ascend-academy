/**
 * The signed-in viewer's loadout, as plain context.
 *
 * Pure on purpose: no auth, no queries. The sealed v4 Spaces namespace may
 * import this (it may not touch auth or data), and App fills it from the
 * outside via ViewerLoadoutBridge. Undefined means "Luna as she ships".
 */
import { createContext, useContext } from 'react';
import type { Loadout } from './types';

export const ViewerLoadoutContext = createContext<Partial<Loadout> | undefined>(undefined);

export function useViewerLoadout(): Partial<Loadout> | undefined {
  return useContext(ViewerLoadoutContext);
}
