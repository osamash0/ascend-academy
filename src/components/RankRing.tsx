/**
 * RankRing — the avatar border that encodes a user's rank tier.
 *
 * A padding-box gradient ring (NO CSS mask — Safari-safe): an outer rounded box
 * fills with the tier gradient, `padding` creates the visible band, and the
 * opaque avatar content covers the centre. Top tiers add an absolutely-
 * positioned conic-gradient layer rotated via a compositor-friendly transform
 * (cheap even in long leaderboard lists). Reduced-motion halts animation (see
 * src/index.css) leaving a static conic ring + glow.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { RankTier } from '@/lib/rank';

export type RankRingSize = 'sm' | 'md' | 'lg' | 'xl';

const RING_PX: Record<RankRingSize, number> = { sm: 1.5, md: 2, lg: 2.5, xl: 3 };
const GLOW_PX: Record<RankRingSize, number> = { sm: 6, md: 9, lg: 12, xl: 16 };
const RADIUS: Record<RankRingSize, number> = { sm: 15, md: 16, lg: 18, xl: 20 };

export function RankRing({
  tier,
  size = 'md',
  children,
}: {
  tier: RankTier;
  size?: RankRingSize;
  children: ReactNode;
}) {
  const ring = RING_PX[size];
  const glowPx = GLOW_PX[size];
  const linear = `linear-gradient(135deg, ${tier.ring.from}, ${tier.ring.to})`;

  return (
    <div
      className={cn('relative h-full w-full overflow-hidden', tier.animated && 'animate-rank-glow')}
      style={{
        padding: ring,
        borderRadius: RADIUS[size],
        background: tier.animated ? undefined : linear,
        boxShadow: tier.glow ? `0 0 ${glowPx}px ${tier.glow}` : undefined,
      }}
    >
      {tier.animated && (
        <span
          aria-hidden
          className="animate-rank-rotate absolute inset-[-50%]"
          style={{ background: `conic-gradient(${tier.ring.from}, ${tier.ring.to}, ${tier.ring.from})` }}
        />
      )}
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}
