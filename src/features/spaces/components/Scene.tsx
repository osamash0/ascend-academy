import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'motion/react';
import { MobileNavSpacer } from './MobileNav';
import { GroundContext, type Surface } from './ground';
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
 *
 * STAGE surfaces (2026-10-10) are the real-course reader's rooms — the course
 * journey, a lecture's overview, the rehearsal. They are pure black, the same
 * black as the deck reader, *including behind the top bar*. Before this they
 * sat on `browse` with a black band drawn from the content down, so the bar
 * kept the console's teal wash above a black page: two grounds with a seam
 * at the bar's edge. On a stage the only colour is the lecture's own
 * (`accent`), and the bar reads the ground from here rather than being told.
 */
export type { Surface };
export { useGround } from './ground';

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
  /**
   * The two-faced reader keeps the room. Its ground is the *other face*,
   * blurred, and that reads as a place only with the console's atmosphere
   * under it — plain black made it a void with a page floating in it
   * (Abi, 2026-09-18: "make it not on focus mode").
   */
  lessonFaces: 'browse',
  practice: 'focus',
  map: 'focus',
  /** The real-course reader's rooms: one black, top bar included. */
  course: 'stage',
  lessonOverview: 'stage',
  rehearsal: 'stage',
} as const satisfies Record<string, Surface>;

interface SceneProps {
  surface: Surface;
  status?: ConsoleStatus;
  gradientIndex?: number;
  motionKey?: string;
  /** A stage's one colour — the lecture's — exposed as `--stage-accent`. */
  accent?: string | null;
  /**
   * The screen mounts no tab bar (the reader), so it reserves no room for
   * one. The spacer made the full-height reader 68px taller than a phone's
   * window, and pressing a control near the bottom scrolled the whole page.
   */
  bare?: boolean;
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
export function Scene({ surface, status, gradientIndex, motionKey, accent, bare, children }: SceneProps) {
  const plain = surface === 'focus';
  const stage = surface === 'stage';

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
      <DepthScene status={status} gradientIndex={gradientIndex} motionKey={motionKey}>
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 bg-[#070b14]"
          style={{ zIndex: 0 }}
          initial={false}
          animate={{ opacity: plain ? 1 : 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 bg-black"
          style={{ zIndex: 0 }}
          initial={false}
          animate={{ opacity: stage ? 1 : 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
        <div
          className="relative"
          style={{ zIndex: 1, ...(accent ? { '--stage-accent': accent } : {}) } as CSSProperties}
        >
          <GroundContext.Provider value={surface}>{children}</GroundContext.Provider>
          {/*
            Room for the fixed bottom bar — on the surfaces that have one.
            
            Mounted here rather than by each screen, because a screen that
            forgets it looks correct until you scroll to the very bottom. But
            the bar itself is mounted by `SpacesTopBar`, which focus surfaces
            deliberately omit: so Practice and the reader reserved 68px on a
            phone for a bar that was not there. The condition is the surface,
            which is the same thing that decides whether the bar exists.
          */}
          {surface !== 'focus' && !bare && <MobileNavSpacer />}
        </div>
      </DepthScene>
  );
}
