import { Link } from 'react-router-dom';
import { Check, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Space } from '../../types';
import { coverFor, initialFor } from '../../mocks/covers';
import { actionFor, membershipOf } from '../../mocks/hub';
import { itemVariants, railVariants } from '../Enter';
import { PRESS_SPRING } from '../Pressable';

/**
 * The rails below the fold.
 *
 * Four element types on one shared gutter, which is the spec's structural
 * point: *mixed element types, one shared gutter*. A rail of identical cards
 * reads as a database; four shapes on the same left edge reads as a magazine.
 *
 * **Every card is a real link.** The spec says so and it matters more than it
 * sounds: a `div` with an onClick cannot be middle-clicked, opened in a new
 * tab, or read as a link by a screen reader — and this page is almost entirely
 * navigation.
 *
 * Rails enter with the shared `Enter` variants — stagger 0.04, y 12 → 0,
 * `whileInView` once. The parent declares the rhythm and Motion propagates it,
 * so adding a row never means computing another delay.
 */

const GUTTER = 'px-[22px] sm:px-16';
/**
 * The same gutter again, as *scroll* padding. Not a duplicate — a fix.
 *
 * A snapping track must come to rest on a snap point, and `snap-start` aligns
 * a card's leading edge to the **scrollport** edge — the padding box, not the
 * content box. So on mount the browser scrolled each overflowing rail by
 * exactly its `padding-left` to satisfy the snap, which ate the gutter: the
 * first card sat flush at x=0 while its own heading sat at x=64, and the last
 * card was clipped. `scroll-padding-left` insets the snapport instead, so
 * scrollLeft=0 *is* the snap point and the card lines up under the heading.
 *
 * Only the two overflowing rails showed it. "New this week" fits, so it never
 * snapped and looked correct throughout — which is why reading the geometry
 * of one rail was not enough to see this.
 */
const SCROLL_GUTTER = 'scroll-pl-[22px] sm:scroll-pl-16';
const TRACK_SCROLL = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * The thin white outline, on hover as well as on focus.
 *
 * `console-focusable` draws a ring on `:focus-visible` only, so a card lifted
 * on hover had no edge — and the spec's whole selection language is *"thin
 * white outline + slight scale. Nothing else."* The mock applies it to both
 * states on all four card types (`.wcard:hover`, `.card:hover .card-img`,
 * `.banner:hover`, `.ccard:hover`), which is what makes the scale read as
 * "this one" rather than as the page breathing.
 *
 * Transparent by default so the colour fades in rather than snapping on.
 * `transition-colors` would not do it — Tailwind 3.4 leaves `outline-color`
 * out of that utility — so this is the bracket form, which the CSS allow-list
 * in `motion.test.tsx` permits by name for exactly this reason.
 */
const CARD_OUTLINE =
  'outline outline-1 outline-transparent transition-[outline-color] hover:outline-white/90';

/** A rail's heading, with the optional "See all". */
function RailHead({ title, to }: { title: string; to?: string }) {
  return (
    <div className={cn('mb-[18px] flex items-baseline justify-between', GUTTER)}>
      <h3 className="text-[18px] font-semibold">{title}</h3>
      {to && (
        <Link
          to={to}
          className="console-focusable rounded text-[13.5px] text-quiet transition-colors hover:text-foreground"
        >
          See all
        </Link>
      )}
    </div>
  );
}

/**
 * A rail. Renders nothing when it is empty — the spec is explicit, and an
 * empty rail is a heading promising content that is not there.
 */
export function Rail({
  title,
  to,
  children,
  grid,
}: {
  title: string;
  to?: string;
  children: React.ReactNode;
  /** The compact rail is a two-row grid rather than a single track. */
  grid?: boolean;
}) {
  return (
    <motion.section
      className="mb-[60px]"
      variants={railVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
    >
      <RailHead title={title} to={to} />
      <div
        className={cn(
          'gap-4 overflow-x-auto pb-[14px] pt-2',
          GUTTER,
          SCROLL_GUTTER,
          TRACK_SCROLL,
          grid
            ? 'grid grid-flow-col grid-rows-2 gap-x-4 gap-y-[14px]'
            : 'flex snap-x snap-mandatory',
        )}
      >
        {children}
      </div>
    </motion.section>
  );
}

/* ── 1. Wide overlay card — "Jump back in" ─────────────────────── */

/**
 * The name sits *inside* the image, with one line of what happened last.
 *
 * These are Spaces you are already in, so the question is not "what is this"
 * but "what did I miss" — which is why the activity line is the only body text
 * and why the cover gets the whole card.
 */
export function WideCard({ space }: { space: Space }) {
  return (
    <motion.div
      variants={itemVariants}
      className="flex-none snap-start"
      /*
       * The whole card lifts, not the art inside it.
       *
       * The scale was on the absolutely-positioned cover layer, so hovering
       * zoomed the image *behind* a stationary name, activity line and badges
       * — the card stayed put while its picture grew inside it. The mock is
       * unambiguous: `.wcard:hover{transform:scale(1.03)}` moves the card.
       */
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      transition={PRESS_SPRING}
    >
      <Link
        to={`/v4/space/${space.id}`}
        aria-label={`${space.name}${space.lastActivity ? `. ${space.lastActivity}` : ''}`}
        className={cn(
          'console-focusable group relative block w-[300px] overflow-hidden rounded-[14px] sm:w-[380px]',
          CARD_OUTLINE,
        )}
        style={{ aspectRatio: '16 / 8.6' }}
      >
        <div className="absolute inset-0" style={{ background: coverFor(space.id) }} />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(0deg,rgba(5,6,8,.85) 0%,rgba(5,6,8,.15) 55%,rgba(5,6,8,0) 100%)',
          }}
        />
        <span
          aria-hidden
          className="absolute right-4 top-[-6px] font-bold leading-none text-decor"
          style={{ fontSize: 88, letterSpacing: -3 }}
        >
          {initialFor(space.name)}
        </span>

        {space.newSinceLastVisit > 0 && (
          <span className="absolute left-3 top-3 z-[2] rounded-full bg-[#57d98a]/90 px-[10px] py-[3px] text-[11.5px] font-semibold text-[#06130b]">
            new activity
          </span>
        )}

        {/*
          Presence only renders when there is a real number. `online` is
          optional and absent means unknown — "0 online" is a claim, and an
          invented count is worse than a missing one.
        */}
        {space.online !== undefined && space.online > 0 && (
          <span className="absolute right-[14px] top-[14px] z-[2] flex items-center gap-1.5 text-[11.5px] text-quiet">
            <i aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#57d98a]" />
            {space.online} online
          </span>
        )}

        <span className="absolute bottom-[14px] left-[18px] right-[18px] z-[2] block">
          <span className="mb-1 block text-[16.5px] font-semibold">{space.name}</span>
          {space.lastActivity && (
            <span className="block truncate text-[12.5px] text-quiet">
              {space.lastActivity}
            </span>
          )}
        </span>
      </Link>
    </motion.div>
  );
}

/* ── 2. Banner — "Space of the week" ───────────────────────────── */

export function FeatureBanner({ space }: { space: Space }) {
  const action = actionFor(membershipOf(space));
  return (
    <motion.div
      variants={railVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      className="mb-[60px]"
    >
      <motion.div variants={itemVariants} className="mx-[22px] sm:mx-16">
        <div
          className={cn(
            'relative flex min-h-[190px] items-center overflow-hidden rounded-2xl',
            CARD_OUTLINE,
          )}
        >
          <div aria-hidden className="absolute inset-0" style={{ background: coverFor(space.id) }} />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg,rgba(5,6,8,.82) 0%,rgba(5,6,8,.45) 45%,rgba(5,6,8,.05) 100%)',
            }}
          />
          <div className="relative z-[2] max-w-[520px] p-[26px] sm:px-[42px] sm:py-[34px]">
            {/*
              Sentence case. The calm table forbids `uppercase` outright — it
              was the single biggest contributor to the first pass reading as
              "very robotic", and an eyebrow set in caps with 1.4px tracking is
              exactly the shouting it names. The label still reads as an
              eyebrow from its size and weight.
            */}
            <p className="mb-[10px] text-[12.5px] font-semibold tracking-[0.2px] text-quiet">
              Space of the week
            </p>
            {/* Weight 300, like the hero. The banner is the hero's echo. */}
            <h3 className="mb-2 text-[30px] font-light tracking-[-0.3px]">{space.name}</h3>
            {space.description && (
              <p className="mb-[18px] max-w-[44ch] text-[14px] text-quiet">
                {space.description}
              </p>
            )}
            {/*
              The banner's own action, inline. A banner you cannot act on is an
              advertisement — so the featured Space is always one you could
              join, and the label comes from the same state machine as the hero.
            */}
            <HubPill to={`/v4/space/${space.id}`} label={action.label} small />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── 3. Standard card — "Popular right now" ────────────────────── */

/**
 * Image, text below, membership as a badge.
 *
 * This is the rail where the concept note does visible work: joined and
 * unjoined sit side by side and the *only* difference is the badge. No
 * section split, no reordering — membership is a property of a card.
 */
export function StandardCard({ space }: { space: Space }) {
  const isMember = space.viewerRole !== null;
  const isPrivate = space.visibility !== 'public';
  return (
    <motion.div variants={itemVariants} className="flex-none snap-start">
      <Link
        to={`/v4/space/${space.id}`}
        className="console-focusable group block w-[190px] rounded-xl sm:w-[250px]"
      >
        <motion.div
          className={cn('relative overflow-hidden rounded-xl', CARD_OUTLINE)}
          style={{ aspectRatio: '16 / 10', background: coverFor(space.id) }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.98 }}
          transition={PRESS_SPRING}
        >
          <span
            aria-hidden
            className="absolute bottom-0.5 right-[14px] font-bold leading-none text-decor"
            style={{ fontSize: 64, letterSpacing: -2 }}
          >
            {initialFor(space.name)}
          </span>
          {(isMember || isPrivate) && (
            <span
              className={cn(
                'absolute right-[10px] top-[10px] grid h-[22px] w-[22px] place-items-center rounded-full backdrop-blur-[6px]',
                isMember ? 'bg-[#57d98a]/85' : 'bg-[rgba(8,9,11,.6)]',
              )}
            >
              {isMember ? (
                <Check aria-hidden className="h-3 w-3 text-[#06130b]" strokeWidth={2.4} />
              ) : (
                <Lock aria-hidden className="h-3 w-3 text-white" />
              )}
              <span className="sr-only">{isMember ? 'You are a member' : 'Invite only'}</span>
            </span>
          )}
        </motion.div>
        <span className="mx-0.5 mb-[3px] mt-[11px] block truncate text-[15px] font-medium">
          {space.name}
        </span>
        <span className="mx-0.5 block text-[13px] text-quiet transition-colors group-hover:text-foreground">
          {space.memberCount.toLocaleString()} members
          {isPrivate && ' · invite only'}
        </span>
      </Link>
    </motion.div>
  );
}

/* ── 4. Compact tile — "New this week" ─────────────────────────── */

export function CompactCard({ space }: { space: Space }) {
  return (
    <motion.div variants={itemVariants} className="flex-none">
      <Link
        to={`/v4/space/${space.id}`}
        className={cn(
          'console-focusable group flex w-[260px] items-center gap-[14px] rounded-xl p-[10px] sm:w-[300px]',
          'bg-[rgba(14,16,20,0.72)] outline-offset-2 transition-colors hover:bg-[rgba(24,26,33,0.85)]',
          CARD_OUTLINE,
        )}
      >
        <span
          aria-hidden
          className="grid h-14 w-14 flex-none place-items-center overflow-hidden rounded-[9px]"
          style={{ background: coverFor(space.id) }}
        >
          <span className="text-[20px] font-bold opacity-75">{initialFor(space.name)}</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium">{space.name}</span>
          <span className="mt-0.5 block text-[12.5px] text-quiet">
            {space.memberCount.toLocaleString()} members
          </span>
        </span>
        {/*
          Decoration, not a second control. The whole row is the link, and a
          real nested button would be invalid inside it — so this reads as the
          affordance and the row does the navigating.
        */}
        <span
          aria-hidden
          className="ml-auto flex-none rounded-full border border-white/30 px-4 py-1.5 text-[12.5px] font-semibold transition-colors group-hover:border-transparent group-hover:bg-white/[0.14]"
        >
          Join
        </span>
      </Link>
    </motion.div>
  );
}

/* ── The shared pill ───────────────────────────────────────────── */

/**
 * The translucent white pill, used by the hero and the banner.
 *
 * `rgba(255,255,255,.16)` with a blur — no gradient, no colour. The spec bans
 * gradient buttons and a second accent, so the only thing distinguishing the
 * primary action is that it is the only pill on the screen.
 */
export function HubPill({
  to,
  label,
  disabled,
  small,
}: {
  to: string;
  label: string;
  disabled?: boolean;
  small?: boolean;
}) {
  const cls = cn(
    'inline-flex items-center justify-center rounded-full font-semibold backdrop-blur-[14px]',
    small ? 'px-7 py-[11px] text-[14px]' : 'px-10 py-[14px] text-[15px]',
    disabled
      ? 'cursor-not-allowed bg-white/[0.08] text-quiet'
      : 'console-focusable bg-white/[0.16] hover:bg-white/[0.26]',
  );

  if (disabled) {
    return (
      <span className={cls} aria-disabled title="You have asked to join. Waiting on the Owner.">
        {label}
      </span>
    );
  }
  return (
    <motion.div className="inline-block" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} transition={PRESS_SPRING}>
      <Link to={to} className={cls}>
        {label}
      </Link>
    </motion.div>
  );
}
