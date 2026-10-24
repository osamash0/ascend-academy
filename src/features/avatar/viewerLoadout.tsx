/**
 * The signed-in viewer's loadout, as plain context.
 *
 * Pure on purpose: no auth, no queries. The sealed v4 Spaces namespace may
 * import this (it may not touch auth or data), and App fills it from the
 * outside via ViewerLoadoutBridge. Undefined means "Luna as she ships".
 */
import { createContext, useContext } from 'react';
import type { Loadout } from './types';
import { itemById } from './catalog';

export const ViewerLoadoutContext = createContext<Partial<Loadout> | undefined>(undefined);

export function useViewerLoadout(): Partial<Loadout> | undefined {
  return useContext(ViewerLoadoutContext);
}

/**
 * The viewer's own light: the colour of Luna's visor, the one they picked in
 * first run. It lights a room that has nothing else to be lit by — Home with
 * no Lesson yet. Null when no loadout is known.
 */
export function useViewerLight(): string | null {
  const loadout = useViewerLoadout();
  return loadout?.visor ? itemById(loadout.visor)?.color ?? null : null;
}
