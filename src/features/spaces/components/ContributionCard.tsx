import {
  ArrowUpFromLine,
  Check,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Heart,
  Image as ImageIcon,
  Link2,
  ListChecks,
  FolderInput,
  Unlink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isLiked, likeCount, toggleLike } from '../mocks/engagement';
import {
  canEndorse,
  canModerate,
  canReport,
  isEndorsed,
  isHidden,
  isPromoted,
  isReported,
  promote,
  report,
  toggleEndorse,
  toggleHidden,
} from '../mocks/moderation';
import { canReanchor, isOrphaned } from '../mocks/reanchor';
import { ReanchorDialog } from './ReanchorDialog';
import { contributionAnchorId } from '../mocks/contributions';
import type { Contribution, ContributionType, Space } from '../types';
import { AuthorLine, EndorsedBadge, GroundingMarker } from './badges';

/**
 * One control in the card's action row.
 *
 * Text-weight and quiet, because this is a Learn surface: Doc 2 asks for
 * minimal chrome, and a row of filled buttons under every contribution would
 * turn the community section into a moderation console.
 *
 * A disabled action always says why. That is the rule the whole namespace
 * settled on after eighteen controls were found rendering enabled and doing
 * nothing — a control either does the thing or explains itself.
 */
function CardAction({
  icon: Icon,
  label,
  active,
  disabled,
  disabledReason,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium transition-colors',
        disabled
          ? 'cursor-not-allowed text-faint'
          : 'console-focusable text-quiet hover:bg-white/[0.06] hover:text-foreground',
        active && !disabled && 'text-success',
        className,
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

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
  /**
   * Called after an act that changes whether this card belongs in the list.
   *
   * Hiding and promoting are filtered by the *parent*, so forcing a re-render
   * of the card alone would leave a promoted contribution sitting in a section
   * it has just left. The card cannot re-filter itself.
   */
  onModerated?: () => void;
  className?: string;
}

export function ContributionCard({
  contribution: c,
  space,
  isOwn,
  featured,
  onModerated,
  className,
}: Props) {
  const Icon = TYPE_ICON[c.type];
  /*
   * Like state comes from the store, not from the fixture's `likedByViewer`.
   * The fixture is the seed; reading it directly is what made this button
   * announce "Tap to remove" and then never change.
   */
  const [, force] = useReducer((n: number) => n + 1, 0);
  const liked = isLiked(c.id);
  const likes = likeCount(c.id);
  /*
   * Endorsed and hidden come from the store too, for the reason directly
   * above: the fixture is the seed. Rendering `c.endorsed` would mean an Owner
   * could endorse something and watch the badge not appear.
   */
  const endorsed = isEndorsed(c.id);
  const hidden = isHidden(c.id);
  const moderator = canModerate(space.viewerRole);
  /*
   * Derived, never `c.orphaned`. The fixture flag records how the contribution
   * started and stays true forever, so a card reading it raw kept the warning
   * border and the warning text after the work had been given a home — which
   * this card was still doing after the first pass at re-anchoring.
   */
  const orphaned = isOrphaned(c);
  const mayRehome = canReanchor(c, space.viewerRole);
  const [rehoming, setRehoming] = useState(false);
  const reported = isReported(c.id);
  const promoted = isPromoted(c.id);
  const navigate = useNavigate();

  return (
    <article
      /*
       * A stable anchor, so a contribution can be linked to rather than merely
       * scrolled past. Space-anchored work has no Lesson and no Concept page —
       * this card, in the Space overview, *is* where it lives — so without an
       * id the only href anyone could build was the Space root, which is the
       * thing Library's rules forbid.
       */
      id={contributionAnchorId(c.id)}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-l-[3px] transition-colors',
        // The one place colour marks origin structurally rather than as a chip.
        'border-l-origin-community/45',
        featured ? 'gap-4 p-6' : 'gap-3 p-5',
        orphaned
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

      {/*
        Orphaned: the anchor was deleted. Surfaced to the Owner *and* to the
        author — nobody's work vanishes silently (Doc 1, Contributions 1).

        The wording follows who is reading. It said "Your work is safe" to
        everyone, including Members looking at somebody else's contribution,
        which is both wrong and slightly alarming — it reads as though their
        own work were involved. The author gets the reassurance; everyone else
        gets the fact.
      */}
      {orphaned && (
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-quiet">
          <Unlink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          {isOwn
            ? 'The Lesson this was attached to was removed. Your work is safe and still here — it just isn’t attached to a Lesson any more.'
            : `The Lesson this was attached to was removed. Nothing of ${c.author.name}’s is lost — it just isn’t attached to a Lesson any more.`}
        </p>
      )}

      {/*
        ── The Owner's acts, and the Member's ──

        Doc 1 rule 4: quality control without a moderation team is origin
        badges, likes, engagement-gated XP, **a report button** and **the
        Owner's right to hide**. Plus endorse and promote, rules 3 and the
        promotion bridge. All of it rendered as state and none of it was doable.

        A quiet row, not a toolbar. This is a Learn surface — Doc 2 asks for
        minimal chrome — so the controls are text-weight and sit under the
        content rather than competing with it.
      */}
      {(moderator || canReport(c) || mayRehome) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-3">
          {/*
            Re-filing sits with the Owner's acts because it is one — Doc 1
            surfaces an orphan to the Owner *and* the author, and both may fix
            it. `canReanchor` is what decides, so a Member looking at someone
            else's orphan sees the explanation and no button.
          */}
          {mayRehome && (
            <CardAction
              icon={FolderInput}
              label="Find it a new home"
              onClick={() => setRehoming(true)}
            />
          )}
          {moderator && (
            <>
              <CardAction
                icon={Check}
                label={endorsed ? 'Endorsed' : 'Endorse'}
                active={endorsed}
                // You cannot endorse your own work: Doc 1 grants XP for being
                // endorsed, so self-endorsement is a button that prints points.
                disabled={!canEndorse(c, space.viewerRole)}
                disabledReason="You can’t endorse your own work."
                onClick={() => {
                  toggleEndorse(c, space.viewerRole);
                  force();
                }}
              />
              <CardAction
                icon={hidden ? Eye : EyeOff}
                label={hidden ? 'Unhide' : 'Hide'}
                onClick={() => {
                  const now = toggleHidden(c, space.viewerRole);
                  force();
                  onModerated?.();
                  toast(now ? 'Hidden' : 'Visible again', {
                    description: now
                      ? 'Still visible to its author and to you. Nothing was deleted.'
                      : 'Everyone in this Space can see it again.',
                  });
                }}
              />
              <CardAction
                icon={ArrowUpFromLine}
                label="Promote"
                disabled={promoted}
                disabledReason="Already in the path."
                onClick={() => {
                  const id = promote(c, space, space.viewerRole);
                  force();
                  onModerated?.();
                  if (!id) return;
                  toast('Promoted into the path', {
                    description: `It is a Lesson now, credited to ${c.author.name}.`,
                    action: { label: 'Open it', onClick: () => navigate(`/v4/space/${space.id}/lesson/${id}`) },
                  });
                }}
              />
            </>
          )}
          {canReport(c) && (
            <CardAction
              icon={Flag}
              label={reported ? 'Reported' : 'Report'}
              active={reported}
              disabled={reported}
              disabledReason="You have reported this."
              className={moderator ? 'ml-auto' : undefined}
              onClick={() => {
                report(c);
                force();
                // NEEDS-BACKEND: no queue, no reviewer. Says that rather than
                // implying an outcome it cannot deliver.
                toast('Reported', {
                  description: 'Whoever runs this Space will be able to see it flagged.',
                });
              }}
            />
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {endorsed && <EndorsedBadge />}
          {/*
            Hidden is not gone. Doc 1's never-vanish pattern: it stays visible
            to its author and to the Owner/Editors, and it says which it is
            rather than simply being absent for them and present for you.
          */}
          {hidden && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
              <EyeOff aria-hidden className="h-3 w-3" />
              Hidden by the Owner
            </span>
          )}
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
      {rehoming && (
        <ReanchorDialog
          contribution={c}
          spaceId={space.id}
          spaceName={space.name}
          viewerRole={space.viewerRole}
          open
          onOpenChange={(v) => !v && setRehoming(false)}
          onMoved={() => {
            setRehoming(false);
            force();
            // The Space's lists change shape — the card may no longer belong
            // in the section that rendered it.
            onModerated?.();
          }}
        />
      )}
    </article>
  );
}
