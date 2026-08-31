import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronDown, ChevronUp, MessageSquare, Plus, Settings2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LaunchButton, gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import type { Membership, Role, Space } from '../types';
import { useSpace } from '../data/useSpaces';
import { viewer } from '../mocks/people';
import { contributionsForLesson, contributionsForSpace } from '../mocks/contributions';
import { canSeeHidden } from '../mocks/engagement';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { LessonRow } from '../components/LessonRow';
import { SpaceMap } from '../components/SpaceMap';
import { SpaceBento } from '../components/SpaceBento';
import { ContributionCard } from '../components/ContributionCard';
import {
  AuthorLine,
  ModeBadge,
  StarButton,
  VisibilityBadge,
} from '../components/badges';
import { Notice, SpacesError, SpacesSkeleton } from '../components/states';
import { AddLessonDialog, ContributeDialog } from '../components/SpaceDialogs';

/**
 * One Space.
 *
 * Tabs are Overview · Map · Members. (Doc 2 lists them as Overview · Members ·
 * Map; the order here is Abi's, 2026-08-30 — the Map belongs beside the path it
 * portrays, and Members is the reference tab you reach for least often.)
 *
 * Overview is ONE SCROLL — the path, then
 * "From the community" beneath it. Community is never a tab: Doc 1 requires it
 * on the same screen as the path, in its own titled section, never interleaved.
 *
 * The header carries the community count and jumps to that section, which is
 * the price of keeping community on the same scroll: in a 40-Lesson Space the
 * section is a long way down and members' work has to stay reachable.
 *
 * The Map tab is deliberately empty. Doc 2 locks how it looks but there are
 * two candidate maps (this per-Space one, and Ascent's cross-Space journey)
 * and which rules apply to which is undecided.
 */

export type SpaceTab = 'overview' | 'map' | 'members';

/** How many Lessons the path shows before it offers "Show more". */
const COLLAPSED_LESSONS = 4;

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  member: 'Member',
};

export default function SpaceScreen({
  spaceId = 's-dbs',
  tab = 'overview',
}: {
  spaceId?: string;
  /** Driven by the URL segment — see SpaceRoute. */
  tab?: SpaceTab;
}) {
  const navigate = useNavigate();
  /** Tabs are routes, so switching one is navigation, not local state. */
  const setTab = (t: SpaceTab) =>
    navigate(t === 'overview' ? `/v4/space/${spaceId}` : `/v4/space/${spaceId}/${t}`);
  const { state, space, lessons, contributions, members } = useSpace(spaceId);
  /*
   * The path collapses by default. Doc 2 rule 3 names the problem — "in a
   * 40-Lesson Space the section is far down, and members' work must stay
   * reachable without scrolling for it" — and answers it with the header jump.
   * That helps once you know the button is there; collapsing the path means
   * you never had to scroll past ten rows to discover the community at all.
   *
   * Community stays on the same scroll as the path, exactly as Doc 1 requires.
   * It is simply closer.
   */
  const [showAllLessons, setShowAllLessons] = useState(false);
  const [addingLesson, setAddingLesson] = useState(false);
  const [contributing, setContributing] = useState(false);
  /* Session writes are outside React state, so a tick re-reads them. */
  const [writeTick, setWriteTick] = useState(0);
  const communityRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  /** The first Lesson not yet finished — the one action this screen offers. */
  const nextLesson = useMemo(
    () =>
      lessons.find((l) => l.state === 'published' && l.progress === 'in-progress') ??
      lessons.find((l) => l.state === 'published' && l.progress === 'not-started'),
    [lessons],
  );

  /**
   * Every contribution in the Space: those anchored to it, plus those anchored
   * to any of its Lessons. One section, sorted by likes, never interleaved
   * with the path above it.
   */
  const allContributions = useMemo(() => {
    const fromLessons = lessons.flatMap((l) => contributionsForLesson(l.id));
    return [...contributionsForSpace(space?.id ?? ''), ...fromLessons]
      .filter((c) => !c.hidden || canSeeHidden(c.author.id, space?.viewerRole ?? null, viewer.id))
      .sort((a, b) => b.likeCount - a.likeCount);
    // `writeTick` re-reads the session store after publishing; the store is
    // outside React, so nothing else would tell this list it had changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributions, lessons, space?.id, writeTick]);

  const chrome = (body: React.ReactNode) => (
    /*
     * All three tabs share one browse surface. The map still needs a near-black
     * ground — "darkness is the content" is unbuildable on a gradient — but it
     * gets that as its own dark *stage panel*, the way map-ui-vision.html draws
     * it, rather than by blacking out the whole viewport.
     *
     * Blacking out the page made the Map read as a different place you had been
     * sent to, instead of the third tab of the Space you were already in.
     * Overview, Members and Map are one screen; only the panel is dark.
     */
    <Scene surface={SURFACES.spaceOverview} status="progress" motionKey={spaceId}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error' || !space) return chrome(<SpacesError what="this Space" />);

  const owned = space.viewerRole === 'owner';
  const isEditor = owned || space.viewerRole === 'editor';
  // In an Open Space every Member may publish Lessons into the path.
  const canAddLesson = isEditor || (space.mode === 'open' && space.viewerRole !== null);
  const SpaceIcon = topicIcon(space.name, space.id);

  const nextIndex = lessons.findIndex((l) => l.id === nextLesson?.id);
  // Always include the Next Lesson: it is the primary action on this screen.
  const collapsedCount = Math.max(COLLAPSED_LESSONS, nextIndex + 1);
  const shownLessons = showAllLessons ? lessons : lessons.slice(0, collapsedCount);
  const hiddenLessonCount = lessons.length - shownLessons.length;

  return chrome(
    <div className="mx-auto max-w-4xl px-6 pb-24 pt-6 lg:px-8">
      <Link
        to="/v4/spaces"
        className="console-focusable mb-6 -ml-2 inline-flex h-9 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.05] hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Spaces
      </Link>

      {/*
        ── Header ──
        Key art behind the title, one primary action, and everything else
        folded into a single quiet meta line. The previous version had five
        control chips of equal weight fighting each other — Continue, Star,
        a members count and a community jump — on a screen Doc 2 puts in Learn
        mode, which asks for "one primary action" and "minimal chrome".

        The members chip is gone entirely: it duplicated the Members tab
        sitting directly beneath it. Star stays, because starring is an action
        you can only take here. The community jump stays because Doc 2 rule 3
        requires it — but as a quiet link, not a coloured button.
      */}
      <header className="relative">
        <div
          aria-hidden
          className={cn(
            'absolute -top-24 left-1/2 h-[320px] w-screen -translate-x-1/2 bg-gradient-to-br opacity-40',
            gradientFor(space.name.length),
          )}
        />
        <div
          aria-hidden
          className="absolute -top-24 left-1/2 h-[320px] w-screen -translate-x-1/2 bg-gradient-to-t from-[#070b14] via-[#070b14]/55 to-transparent"
        />
        <SpaceIcon
          aria-hidden
          className="pointer-events-none absolute right-4 -top-8 hidden h-36 w-36 text-white/[0.05] lg:block"
        />

        <div className="relative space-y-4">
          <h1 className="text-4xl font-bold tracking-[-0.02em] sm:text-[44px]">{space.name}</h1>

          {/* One line: who owns it, how it works, who can see it. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-quiet">
            <AuthorLine person={space.owner} prefix="Owner" />
            <span aria-hidden className="text-faint">·</span>
            <ModeBadge mode={space.mode} />
            <VisibilityBadge visibility={space.visibility} />
            {space.state === 'archived' && (
              <span className="rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
                Archived
              </span>
            )}
          </div>

          {/*
            What "archived" costs you, said once, quietly. The badge above
            names the state; this says what follows from it — read-only, and
            no XP. `Notice` was built for exactly this and nothing had ever
            mounted it.
          */}
          {space.state === 'archived' && (
            <Notice className="mt-3">
              This Space is read-only. Your progress is kept, and nothing here earns XP.
            </Notice>
          )}

          {space.description && (
            <p className="max-w-[62ch] text-[15.5px] leading-[1.75] text-quiet">
              {space.description}
            </p>
          )}

          {/* No classification here — you are already inside this Space.
              It lives on the Discover card, where it helps you decide. */}

          <div className="flex flex-wrap items-center gap-4 pt-2">
            {nextLesson && (
              <LaunchButton
                label={space.viewerProgress > 0 ? 'Continue' : 'Start'}
                onClick={() => navigate(`/v4/space/${space.id}/lesson/${nextLesson.id}`)}
              />
            )}
            <StarButton spaceId={space.id} viewerOwns={owned} />

            {/* Settings is a separate Studio screen, never a fourth tab. */}
            {owned && (
              <button
                type="button"
                onClick={() => navigate(`/v4/space/${space.id}/manage`)}
                className="console-focusable inline-flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
              >
                <Settings2 aria-hidden className="h-3.5 w-3.5" />
                Manage
              </button>
            )}

            {/*
              Doc 2 rule 3: the header carries the community count and jumps to
              that section — the price of keeping community on the same scroll
              as the path. A link, not a button competing with Continue.
            */}
            {allContributions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTab('overview');
                  requestAnimationFrame(() =>
                    communityRef.current?.scrollIntoView({
                      behavior: reduceMotion ? 'auto' : 'smooth',
                      block: 'start',
                    }),
                  );
                }}
                className="console-focusable inline-flex items-center gap-1.5 rounded-md py-1 text-[13.5px] text-quiet underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                <MessageSquare aria-hidden className="h-3.5 w-3.5" />
                {allContributions.length} from the community
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div
        role="tablist"
        aria-label="Space"
        className="mt-8 flex items-center gap-1 border-b border-white/[0.08]"
      >
        {(['overview', 'map', 'members'] as SpaceTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'console-focusable relative h-12 px-4 text-[14px] font-medium capitalize transition-colors',
              tab === t ? 'text-foreground' : 'text-quiet hover:text-foreground',
            )}
          >
            {t}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-3 -bottom-px h-0.5 rounded-full transition-opacity',
                tab === t ? 'bg-primary opacity-100' : 'opacity-0',
              )}
            />
          </button>
        ))}
      </div>

      {/* ── Overview: one scroll — at a glance, the path, then the community ── */}
      {tab === 'overview' && (
        <>
          {/* PS5-style widget strip. A summary you can act from; the path
              directly beneath is still the thing you work through. */}
          <div className="mt-7">
            <SpaceBento
              space={space}
              lessons={lessons}
              nextLesson={nextLesson}
              contributions={allContributions}
              members={members}
              onOpenMembers={() => setTab('members')}
              onOpenMap={() => setTab('map')}
              onOpenCommunity={() =>
                communityRef.current?.scrollIntoView({
                  behavior: reduceMotion ? 'auto' : 'smooth',
                  block: 'start',
                })
              }
            />
          </div>

          <section aria-labelledby="path-heading" className="mt-10">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 id="path-heading" className="text-[14px] font-medium text-quiet">
                The path · {lessons.length} {lessons.length === 1 ? 'Lesson' : 'Lessons'}
              </h2>
              {/* Create lives on the screen that owns the object. In an Open
                  Space this is not Owner-only — every Member sees it. */}
              {canAddLesson && space.state === 'active' && (
                <button
                  type="button"
                  onClick={() => setAddingLesson(true)}
                  className="console-focusable inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-slate-900 transition-transform hover:scale-[1.03]"
                >
                  <Plus aria-hidden className="h-4 w-4" />
                  Add Lesson
                </button>
              )}
            </div>

            {lessons.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
                <p className="mb-1.5 text-[15px] font-bold">No Lessons yet</p>
                <p className="mx-auto mb-6 max-w-[46ch] text-[14px] leading-relaxed text-quiet">
                  {space.mode === 'open'
                    ? 'This Space is Open — anyone here can add the first one. Upload material and the Lesson builds itself.'
                    : owned
                      ? 'Upload your material and the first Lesson builds itself.'
                      : 'The Owner hasn’t published anything here yet.'}
                </p>
                {canAddLesson && (
                  <button
                    type="button"
                    onClick={() => setAddingLesson(true)}
                    className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                    Add the first Lesson
                  </button>
                )}
              </div>
            ) : (
              <>
                <ol className="space-y-3">
                  {shownLessons.map((l) => (
                    <li key={l.id}>
                      <LessonRow lesson={l} space={space} isNext={l.id === nextLesson?.id} />
                    </li>
                  ))}
                </ol>

                {hiddenLessonCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllLessons(true)}
                    className="console-focusable mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-[14px] font-medium text-quiet transition-colors hover:border-white/30 hover:text-foreground"
                  >
                    <ChevronDown aria-hidden className="h-4 w-4" />
                    Show {hiddenLessonCount} more {hiddenLessonCount === 1 ? 'Lesson' : 'Lessons'}
                  </button>
                )}

                {showAllLessons && lessons.length > COLLAPSED_LESSONS && (
                  <button
                    type="button"
                    onClick={() => setShowAllLessons(false)}
                    className="console-focusable mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-[14px] font-medium text-quiet transition-colors hover:border-white/30 hover:text-foreground"
                  >
                    <ChevronUp aria-hidden className="h-4 w-4" />
                    Show less
                  </button>
                )}
              </>
            )}
          </section>

          {/* Separate container, never one merged list, ordering never interleaved. */}
          <section
            ref={communityRef}
            aria-labelledby="community-heading"
            className="mt-12 scroll-mt-6 border-t border-white/[0.08] pt-8"
          >
            <div className="mb-1.5 flex items-center justify-between gap-4">
              <h2
                id="community-heading"
                className="text-[14px] font-medium text-origin-community"
              >
                From the community · {allContributions.length}
              </h2>
              {space.state === 'active' && space.viewerRole !== null && (
                <button
                  type="button"
                  onClick={() => setContributing(true)}
                  className="console-focusable inline-flex h-9 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
                >
                  <Plus aria-hidden className="h-4 w-4" />
                  Contribute
                </button>
              )}
            </div>
            <p className="mb-5 text-[13px] text-faint">
              Made by members of this Space. Sorted by what people found most useful.
            </p>

            {allContributions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
                <Sparkles aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
                <p className="mb-1.5 text-[15px] font-bold">Nothing from the community yet</p>
                <p className="mx-auto max-w-[44ch] text-[14px] leading-relaxed text-quiet">
                  Summaries, worked examples, mnemonics — anything that helped you will
                  help the next person.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {allContributions.map((c, i) => (
                  <ContributionCard
                    key={c.id}
                    contribution={c}
                    space={space}
                    isOwn={c.author.id === viewer.id}
                    /* Likes sort this section — the top one should look it. */
                    featured={i === 0 && allContributions.length > 1}
                    className={i === 0 && allContributions.length > 1 ? 'sm:col-span-2' : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Members ── */}
      {tab === 'members' && (
        <section className="mt-8">
          <h2 className="mb-5 text-[14px] font-medium text-quiet">
            {space.memberCount.toLocaleString()} {space.memberCount === 1 ? 'Member' : 'Members'}
          </h2>

          {/*
            A Space you have not joined shows what is *inside* it — Lessons, so
            you are not joining blind — but not who is in it. That is a real
            state, not missing data. Without this branch, Discover Spaces
            printed "1,204 Members" over an empty list and then
            "Showing 0 of 1,204".
          */}
          {members.length === 0 && (
            <p className="rounded-2xl border border-dashed border-white/12 px-6 py-10 text-center text-[14px] leading-relaxed text-quiet">
              {space.viewerRole === null
                ? 'Who is in this Space is visible to its members. Join to see them.'
                : 'Nobody else is here yet.'}
            </p>
          )}

          <ul className="space-y-1">
            {members.map((m: Membership) => (
              <li
                key={m.person.id}
                className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 hover:bg-white/[0.03]"
              >
                {/* Every byline links to that person's public profile — a
                    claim this comment made before the screen existed. */}
                <AuthorLine person={m.person} linkToProfile />
                <div className="flex items-center gap-3">
                  <span className="text-[12.5px] text-faint tabular-nums">{m.progress}%</span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-[3px] text-[11.5px] font-medium',
                      m.role === 'owner'
                        ? 'bg-primary/15 text-primary'
                        : m.role === 'editor'
                          ? 'bg-secondary/15 text-secondary'
                          : 'bg-white/[0.06] text-quiet',
                    )}
                  >
                    {ROLE_LABEL[m.role]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {members.length > 0 && members.length < space.memberCount && (
            <p className="mt-4 text-[13px] text-faint">
              Showing {members.length} of {space.memberCount.toLocaleString()}.
            </p>
          )}
        </section>
      )}

      {tab === 'map' && <SpaceMap space={space} lessons={lessons} />}

      <AddLessonDialog
        space={space}
        open={addingLesson}
        onOpenChange={setAddingLesson}
        onAdded={() => setWriteTick((n) => n + 1)}
      />
      <ContributeDialog
        space={space}
        open={contributing}
        onOpenChange={setContributing}
        onAdded={() => setWriteTick((n) => n + 1)}
      />
    </div>,
  );
}
