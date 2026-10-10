/**
 * MyLuna — the signed-in student's own Luna as their guide (dashboard
 * invite, tour, badge popup). Same outfit as everywhere else, kept calm:
 * no scene, aura or orbiting companion, so she accompanies the moment
 * instead of competing with it.
 */
import { LunaAvatar } from './LunaAvatar';
import { useLoadout } from './useAvatar';
import type { Mood } from './types';

export function MyLuna({
  variant = 'head',
  size = 80,
  mood,
  animated = true,
  className,
}: {
  variant?: 'head' | 'full';
  size?: number;
  mood?: Mood;
  animated?: boolean;
  className?: string;
}) {
  const { loadout, mood: liveMood } = useLoadout();
  return (
    <LunaAvatar
      loadout={{ ...loadout, aura: 'aura-none', companion: 'companion-none' }}
      mood={mood ?? liveMood}
      variant={variant}
      size={size}
      animated={animated}
      showBackdrop={false}
      className={className}
    />
  );
}
