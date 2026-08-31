import {
  FileText,
  Heart,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Unlink,
} from 'lucide-react';
import { useReducer } from 'react';
import { cn } from '@/lib/utils';
import { isLiked, likeCount, toggleLike } from '../mocks/engagement';
import type { Contribution, ContributionType, Space } from '../types';
import { AuthorLine, EndorsedBadge, GroundingMarker } from './badges';

/**
 * One member contribution.
 *
 * Visually distinct from a Lesson row on purpose — Doc 1's separation rule is
 * that a learner "should never have to look twice to know who made something".
 * Lessons are rows in an ordered path; contributions are cards in an unordered,
 * likes-sorted section. Different shape, different container, same screen.
 *
 * Three things this design does deliberately:
 *
 *   • **No "Community" badge.** The section is titled "From the community" and
 *     every card in it is Community by definition — Official content is a
 *     Lesson, not a contribution. A badge on every item is noise that drowns
 *     the badges which actually vary (Endorsed, Grounding).
 *   • **An excerpt, not just a headline.** You have to be able to judge whether
 *     something will help before opening it, or a busy section is unusable.
 *   • **Likes sort this section, so the top item looks like it.** The
 *     `featured` variant gives the most-liked contribution real weight, instead
 *     of a 212-like cheat sheet looking identical to a 4-like one.
 */

const TYPE_ICON: Record<ContributionType, typeof FileText> = {
  text: FileText,
  pdf: FileText,
  image: ImageIcon,
  link: Link2,
  'practice-set': ListChecks,
};

const TYPE_LABEL: Record<ContributionType, string> = {
  text: 'Write-up',
  pdf: 'PDF',
  image: 'Image',
  link: 'Link',
  'practice-set': 'Practice set',
};

interface Props {
  contribution: Contribution;
  space: Space;
  /** True when the viewer wrote it — you cannot like your own work. */
  isOwn?: boolean;
  /** The top-liked item in its section. Given more room and a warmer ground. */
  featured?: boolean;
  className?: string;
}

export function ContributionCard({ contribution: c, space, isOwn, featured, className }: Props) {
  const Icon = TYPE_ICON[c.type];
  /*
   * Like state comes from the store, not from the fixture's `likedByViewer`.
   * The fixture is the seed; reading it directly is what made this button
   * announce "Tap to remove" and then never change.
   */
  const [, force] = useReducer((n: number) => n + 1, 0);
  const liked = isLiked(c.id);
  const likes = likeCount(c.id);

  return (
    <article
      className={cn(
        'group relative flex flex-col rounded-2xl border border-l-[3px] transition-colors',
        // The one place colour marks origin structurally rather than as a chip.
        'border-l-origin-community/45',
        featured ? 'gap-4 p-6' : 'gap-3 p-5',
        c.orphaned
          ? 'border-warning/25 bg-warning/[0.04]'
          : featured
            ? 'border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.07]'
            : 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.045]',
        className,
      )}
    >
      {/*
        Person first. A Lesson row leads with its number — it is a position in
        an ordered path. A contribution leads with its author, because it is
        somebody's voice. Inverting the reading order is what makes the two
        unmistakable at a glance, which is exactly what Doc 1's separation rule
        asks for: "never have to look twice to know who made something."
      */}
      <div className="flex items-center gap-2.5">
        <AuthorLine person={c.author} />
        <span aria-hidden className="text-faint">·</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-faint">
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {TYPE_LABEL[c.type]}
        </span>
      </div>

      <h4
        className={cn(
          'font-semibold leading-snug text-foreground',
          featured ? 'text-[19px]' : 'text-[15.5px]',
        )}
      >
        {c.title}
      </h4>

      {c.excerpt && (
        <p
          className={cn(
            'leading-relaxed text-quiet',
            featured ? 'line-clamp-4 text-[14.5px]' : 'line-clamp-3 text-[14px]',
          )}
        >
          {c.excerpt}
        </p>
      )}

      {/* Orphaned: the anchor was deleted. Surfaced to the Owner *and* to the
          author — nobody's work vanishes silently (Doc 1, Contributions 1). */}
      {c.orphaned && (
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-quiet">
          <Unlink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          The Lesson this was attached to was removed. Your work is safe — pick a new
          place for it.
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {c.endorsed && <EndorsedBadge />}
          <GroundingMarker
            grounding={c.grounding}
            spaceGroundingEnabled={space.groundingEnabled}
          />
        </div>

        {/*
          Like belongs to contributions and never to a Space — a different verb,
          icon and colour from Star, so the two cannot be confused. You cannot
          like your own work.
        */}
        <button
          type="button"
          disabled={isOwn}
          onClick={() => {
            toggleLike(c.id, c.author.id);
            force();
          }}
          aria-pressed={liked}
          aria-label={
            isOwn
              ? `${likes} likes. You can’t like your own contribution.`
              : liked
                ? `Liked. ${likes} likes. Tap to remove.`
                : `Like this. ${likes} likes.`
          }
          title={isOwn ? 'You can’t like your own contribution.' : undefined}
          className={cn(
            'console-focusable inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium tabular-nums transition-colors',
            liked
              ? 'border-like/40 bg-like/12 text-like'
              : 'border-white/12 bg-white/[0.04] text-quiet hover:bg-white/[0.08]',
            isOwn && 'cursor-not-allowed opacity-45 hover:bg-white/[0.04]',
          )}
        >
          <Heart aria-hidden className={cn('h-3.5 w-3.5', liked && 'fill-like')} />
          {likes}
        </button>
      </div>
    </article>
  );
}
