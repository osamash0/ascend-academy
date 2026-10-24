import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { useLoadout } from '@/features/avatar/useAvatar';
import { completeActivationOnboarding } from '@/services/onboardingService';
import type { Light } from './lights';

/**
 * What first run writes, and nothing else: a name, Luna's look, and — when v4
 * is where the person is going — the completion flag. In legacy mode the
 * study-path step that follows sets the flag, exactly as it did before.
 */
export function useFirstRun(v4First: boolean) {
  const { user, profile, refreshProfile } = useAuth();
  const { loadout, save } = useLoadout();

  const saveName = useCallback(
    async (raw: string) => {
      if (!user) throw new Error('Not signed in');
      const name = raw.trim().slice(0, NAME_MAX);
      // display_name too: the social layer and v4's greeting read it.
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: name, display_name: name })
        .eq('user_id', user.id);
      if (error) throw error;
    },
    [user],
  );

  const finish = useCallback(
    async (light: Light) => {
      await save({ ...loadout, visor: light.visor, suit: light.suit });
      // No study goal: nothing in v4 reads it, so first run does not ask.
      if (v4First) await completeActivationOnboarding('material');
      // The guards read the profile; refresh it so the next screen lets them in.
      await refreshProfile();
    },
    [loadout, save, v4First, refreshProfile],
  );

  return { initialName: profile?.full_name ?? '', loadout, saveName, finish };
}

export const NAME_MAX = 60;
