/**
 * Fills ViewerLoadoutContext from the real, signed-in loadout. Mounted by App,
 * outside any sealed namespace, so screens that may not touch auth (v4
 * Spaces) still draw the viewer's own Luna.
 */
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useLoadout } from './useAvatar';
import { ViewerLoadoutContext } from './viewerLoadout';

export function ViewerLoadoutBridge({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { loadout } = useLoadout();
  return <ViewerLoadoutContext.Provider value={user ? loadout : undefined}>{children}</ViewerLoadoutContext.Provider>;
}
