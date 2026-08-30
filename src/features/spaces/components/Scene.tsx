import type { ReactNode } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { DepthScene } from '@/components/console';
import type { ConsoleStatus } from '@/components/console';

/**
 * Where the cosmic theme is spent.
 *
 * Doc 1 and Doc 2 rule 10 say the theme is spent on the map "and nowhere
 * else". The console language this product is built in spends it on every
 * screen. Both cannot be true, and the decision (2026-08-30, Abi) was to
 * split the difference rather than pick a side:
 *
 *   BROWSE surfaces keep the console texture — the parallax wash, ambient
 *   glow and drifting particles. These are screens where you are *choosing*
 *   something, the atmosphere is doing real work, and nothing on screen
 *   depends on darkness meaning anything.
 *
 *   FOCUS surfaces get plain near-black — no gradient, no glow, no particles.
 *   These are screens where you are *reading* or *seeing where you are*, and
 *   the texture would compete with the content.
 *
 * The map is the reason this line exists. Doc 2 rule 2 — "darkness is the
 * content, not the background; unlit means unlearned" — is unbuildable on top
 * of a gradient: if the ground already glows, an unlit Lesson cannot read as
 * unlearned. So the map must be `focus`, and so must the reader beside it.
 *
 * Consequence for Doc 2: rule 10 needs amending from "the theme is spent here
 * and nowhere else" to something like "the map is themed *structurally*;
 * browse surfaces are textured; focus surfaces are plain."
 */
export type Surface = 'browse' | 'focus';

export const SURFACES = {
  /** Choosing. Texture is atmosphere and costs nothing. */
  home: 'browse',
  spaces: 'browse',
  spaceOverview: 'browse',
  spaceMembers: 'browse',
  library: 'browse',
  social: 'browse',
  profile: 'browse',
  /** Reading or seeing. Texture competes with the content. */
  lessonReader: 'focus',
  practice: 'focus',
  map: 'focus',
} as const satisfies Record<string, Surface>;

interface SceneProps {
  surface: Surface;
  status?: ConsoleStatus;
  gradientIndex?: number;
  motionKey?: string;
  children: ReactNode;
}

/**
 * Picks the right ground for the screen. Every v4 screen renders through this
 * rather than reaching for DepthScene directly, so the rule above is enforced
 * by construction instead of by remembering.
 *
 * **One tree, always.** An earlier version returned either a plain wrapper or a
 * DepthScene depending on `surface`. Because those are different component
 * types at the same position, React unmounted and rebuilt everything below on
 * every switch — the whole screen, top bar included. Moving between a Space's
 * Overview and its Map read as a page refresh.
 *
 * So the structure never changes. `DepthScene` always mounts, and a near-black
 * blackout layer fades in over its wallpaper when the surface is `focus`. The
 * ground changes; nothing remounts. The blackout sits above the parallax
 * layers and below the content, inside DepthScene's own stacking context.
 *
 * The fade is opacity-only, which is exactly what `reducedMotion="user"`
 * preserves — so it still reads as a deliberate change for someone who has
 * asked for less motion, without anything moving.
 */
export function Scene({ surface, status, gradientIndex, motionKey, children }: SceneProps) {
  const plain = surface === 'focus';

  /*
   * reducedMotion="user" disables transform and layout animations while
   * *keeping* opacity transitions. That distinction matters: a cross-fade
   * still tells you the content changed — the educational part — without the
   * movement that causes nausea. Doing this per-component with duration:0
   * killed the fade too.
   *
   * One wrapper covers every motion component below it, including ones not
   * written yet, so the rule cannot be forgotten on the next screen.
   */
  return (
    <MotionConfig reducedMotion="user">
      <DepthScene status={status} gradientIndex={gradientIndex} motionKey={motionKey}>
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 bg-[#070b14]"
          style={{ zIndex: 0 }}
          initial={false}
          animate={{ opacity: plain ? 1 : 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="relative" style={{ zIndex: 1 }}>
          {children}
        </div>
      </DepthScene>
    </MotionConfig>
  );
}
