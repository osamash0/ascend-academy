import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ChevronDown, ChevronUp, MessageSquare, Play, Plus, Settings2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pressable } from '../components/Pressable';
import { topicIcon } from '@/lib/topicIcon';
import type { Membership, Role, Space } from '../types';
import { useSpace } from '../data/useSpaces';
import { viewer } from '../mocks/people';
import { contributionsForLesson, contributionsForSpace } from '../mocks/contributions';
import { visibleContributions } from '../mocks/engagement';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { LessonRow } from '../components/LessonRow';
import { SpaceMap } from '../components/SpaceMap';
import { ContributionCard } from '../components/ContributionCard';
import {
  AuthorLine,
  ModeBadge,
  StarButton,
  VisibilityBadge,
} from '../components/badges';
import { Notice, SpacesError, SpacesSkeleton } from '../components/states';
import { PRESS_SPRING } from '../components/Pressable';
import {
  Masthead,
  Pool,
  Sep,
  Skylight,
  StageRow,
  backLink,
  ghostPillSm,
  stageAccentFor,
  UpNext,
  whitePillSm,
} from '../components/stage';
import { AddLessonDialog, ContributeDialog } from '../components/SpaceDialogs';
import { formatNumber } from '../i18n/format';

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

/** Keys under `v4Space:demo.roles`, translated at render. */
const ROLE_KEY: Record<Role, string> = {
  owner: 'demo.roles.owner',
  editor: 'demo.roles.editor',
  member: 'demo.roles.member',
};

export default function SpaceScreen({
  spaceId = 's-dbs',
  tab = 'overview',
}: {
  spaceId?: string;
  /** Driven by the URL segment — see SpaceRoute. */
  tab?: SpaceTab;
}) {
  const { t } = useTranslation('v4Space');
  const navigate = useNavigate();
  /** Tabs are routes, so switching one is navigation, not local state. */
  const setTab = (next: SpaceTab) =>
    navigate(next === 'overview' ? `/v4/space/${spaceId}` : `/v4/space/${spaceId}/${next}`);
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
    /*
     * `visibleContributions`, not a hand-written filter.
     *
     * This screen kept its own `!c.hidden || canSeeHidden(...)` — the ninth
     * copy of that rule — and the cost showed up the moment promotion existed:
     * a promoted contribution created its Lesson, the path went 5 → 6, and the
     * card stayed sitting in the community section below it. The rule had
     * grown a second clause and only one of the nine copies knew.
     */
    return visibleContributions(
      [...contributionsForSpace(space?.id ?? ''), ...fromLessons],
      space?.viewerRole ?? null,
    ).sort((a, b) => b.likeCount - a.likeCount);
    // `writeTick` re-reads the session store after publishing; the store is
    // outside React, so nothing else would tell this list it had changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributions, lessons, space?.id, writeTick]);

  /*
   * Arriving at a contribution rather than at the Space it sits in.
   *
   * Space-anchored work has no page of its own — this overview is where it
   * lives — so Library and ⌘K address it by fragment
   * (`/v4/space/x#contribution-y`). React Router does not scroll to fragments;
   * without this the link lands at the top of the Space and the person is left
   * to find the card, which is the behaviour the fragment was meant to replace.
   *
   * Depends on `allContributions` as well as the hash: the list is built from
   * a store read after mount, so on a cold load the element does not exist yet
   * on the first pass. `block: 'center'` rather than the default, so the card
   * is not left under the sticky header.
   */
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
  }, [hash, allContributions]);

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
    <Scene
      surface={SURFACES.spaceOverview}
      status="progress"
      motionKey={spaceId}
      accent={space ? stageAccentFor(space.name.length) : null}
    >
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
  const accent = stageAccentFor(space.name.length);
  const published = lessons.filter((l) => l.state === 'published');

  const nextIndex = lessons.findIndex((l) => l.id === nextLesson?.id);
  // Always include the Next Lesson: it is the primary action on this screen.
  const collapsedCount = Math.max(COLLAPSED_LESSONS, nextIndex + 1);
  const shownLessons = showAllLessons ? lessons : lessons.slice(0, collapsedCount);
  const hiddenLessonCount = lessons.length - shownLessons.length;

  return chrome(
    <div className="relative">
      {/* The stage's one light, in the colour of this Space's own cover —
          the tile you picked on Spaces lights the room you walk into. */}
      <Skylight accent={accent} />
      <Pool accent={accent} className="top-[120px] h-[520px] opacity-60" />

    <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-6 lg:px-8">
      <Link to="/v4/spaces" className={backLink}>
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Spaces
      </Link>

      {/*
        ── Header ──
        The lecture overview's masthead, one level up: centred, one primary
        action, everything else quiet. Star stays, because starring is an
        action you can only take here. The community jump stays because Doc 2
        rule 3 requires it — but as a quiet link, not a coloured button.
      */}
      <header className="relative mt-6">
        <div className="flex justify-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10"
            style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)` }}
          >
            <SpaceIcon aria-hidden className="h-6 w-6" style={{ color: accent }} />
          </span>
        </div>

        <Masthead
          className="mt-6"
          title={space.name}
          lede={space.description}
          meta={
            <>
              {/* The Owner is a person, not a label: their own astronaut,
                  and a way to their profile. */}
              <AuthorLine person={space.owner} prefix={t('demo.header.owner')} linkToProfile />
              <StarButton spaceId={space.id} viewerOwns={owned} />
              {/* Settings is a separate Studio screen, never a fourth tab. */}
              {owned && (
                <button
                  type="button"
                  onClick={() => navigate(`/v4/space/${space.id}/manage`)}
                  className={ghostPillSm}
                >
                  <Settings2 aria-hidden className="h-3.5 w-3.5" />
                  {t('demo.header.manage')}
                </button>
              )}
              {space.state === 'archived' && (
                <span className="rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
                  {t('demo.header.archived')}
                </span>
              )}
            </>
          }
        />

        {/*
          What "archived" costs you, said once, quietly. The badge above
          names the state; this says what follows from it — read-only, and
          no XP.
        */}
        {space.state === 'archived' && (
          <Notice className="mx-auto mt-5 max-w-xl">
            {t('demo.header.archivedNotice')}
          </Notice>
        )}

        {/*
          ── Up next ──
          The one action on this screen, as a thing rather than a button: the
          next Lesson itself, lit in the Space's colour. It replaced a
          "Continue" button *and* a "Continue" bento cell that said the same
          thing twice (Abi, 2026-10-10: "Continue is duplicated").
        */}
        {nextLesson && (
          <div className="mt-12">
            <UpNext
              to={`/v4/space/${space.id}/lesson/${nextLesson.id}`}
              number={nextLesson.order}
              kicker={
                nextLesson.percentComplete > 0
                  ? t('demo.upNext.percentRead', { percent: nextLesson.percentComplete })
                  : t('demo.upNext.kicker')
              }
              title={nextLesson.title}
              percent={nextLesson.percentComplete}
              accent={accent}
              verb={space.viewerProgress > 0 ? t('demo.upNext.continue') : t('demo.upNext.start')}
            />
          </div>
        )}

        {/* The path at a glance — each segment is its Lesson, and opens it. */}
        {published.length > 0 && (
          <div className="mt-6 flex flex-col items-center gap-2.5">
            <ol className="flex flex-wrap justify-center gap-1">
              {published.map((l) => (
                <li key={l.id}>
                  <Link
                    to={`/v4/space/${space.id}/lesson/${l.id}`}
                    aria-label={t(l.progress === 'done' ? 'demo.glance.segmentDone' : 'demo.glance.segment', {
                      order: l.order,
                      title: l.title,
                    })}
                    title={`${l.order}. ${l.title}`}
                    className="console-focusable block py-1.5"
                  >
                    <span
                      className={cn(
                        'block h-1 w-8 rounded-full transition-colors hover:bg-white/40',
                        l.progress === 'done' ? 'bg-success' : l.id !== nextLesson?.id && 'bg-white/[0.12]',
                      )}
                      style={l.id === nextLesson?.id ? { background: accent } : undefined}
                    />
                  </Link>
                </li>
              ))}
            </ol>
            <p className="text-[12.5px] tabular-nums text-quiet">
              {t('demo.glance.done', {
                done: published.filter((l) => l.progress === 'done').length,
                total: published.length,
              })}
              {/*
                Doc 2 rule 3: the header carries the community count and jumps to
                that section — the price of keeping community on the same scroll
                as the path. A link, not a button competing with Up next.
              */}
              {allContributions.length > 0 && (
                <>
                  <Sep />
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
                    className="console-focusable inline-flex items-center gap-1.5 rounded-md text-quiet underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    <MessageSquare aria-hidden className="h-3.5 w-3.5" />
                    {t('demo.glance.community', { count: allContributions.length })}
                  </button>
                </>
              )}
            </p>
          </div>
        )}
      </header>

      {/* ── Tabs ── */}
      <div
        role="tablist"
        aria-label={t('demo.tabs.label')}
        className="mt-16 flex items-center justify-center gap-1 border-b border-white/[0.08]"
      >
        {(['overview', 'map', 'members'] as SpaceTab[]).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              'console-focusable relative h-12 px-4 text-[14px] font-medium capitalize transition-colors',
              tab === name ? 'text-foreground' : 'text-quiet hover:text-foreground',
            )}
          >
            {t(`demo.tabs.${name}`)}
            {/*
              One indicator that *moves*, rather than three that cross-fade.
              `layoutId` makes Motion morph the same element between tabs, which
              is both the spec's shared-element rule and what the top bar
              already does for its pills — the two tab strips in the product now
              behave the same way instead of one sliding and one fading.
            */}
            {tab === name && (
              <motion.span
                aria-hidden
                layoutId="v4SpaceTab"
                className="absolute inset-x-3 -bottom-px h-0.5 rounded-full"
                style={{ background: accent }}
                transition={PRESS_SPRING}
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Overview: one scroll — at a glance, the path, then the community ── */}
      {tab === 'overview' && (
        <>
          <StageRow
            id="path-heading"
            title={t('demo.path.title')}
            count={lessons.length}
            lede={t('demo.path.lede')}
            action={
              /* Create lives on the screen that owns the object. In an Open
                 Space this is not Owner-only — every Member sees it. */
              canAddLesson &&
              space.state === 'active' && (
                <Pressable type="button" onClick={() => setAddingLesson(true)} className={whitePillSm}>
                  <Plus aria-hidden className="h-4 w-4" />
                  {t('demo.path.add')}
                </Pressable>
              )
            }
          >
            {lessons.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
                <p className="mb-1.5 text-[15px] font-semibold">{t('demo.path.emptyTitle')}</p>
                <p className="mx-auto mb-6 max-w-[46ch] text-[14px] leading-relaxed text-quiet">
                  {space.mode === 'open'
                    ? t('demo.path.emptyOpen')
                    : owned
                      ? t('demo.path.emptyOwned')
                      : t('demo.path.emptyOther')}
                </p>
                {canAddLesson && (
                  <button
                    type="button"
                    onClick={() => setAddingLesson(true)}
                    className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                    {t('demo.path.addFirst')}
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
                    {t('demo.path.showMore', { count: hiddenLessonCount })}
                  </button>
                )}

                {showAllLessons && lessons.length > COLLAPSED_LESSONS && (
                  <button
                    type="button"
                    onClick={() => setShowAllLessons(false)}
                    className="console-focusable mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-[14px] font-medium text-quiet transition-colors hover:border-white/30 hover:text-foreground"
                  >
                    <ChevronUp aria-hidden className="h-4 w-4" />
                    {t('demo.path.showLess')}
                  </button>
                )}
              </>
            )}
          </StageRow>

          {/* Separate container, never one merged list, ordering never interleaved. */}
          <div ref={communityRef} className="scroll-mt-24">
          <StageRow
            id="community-heading"
            title={t('demo.community.title')}
            count={allContributions.length}
            lede={t('demo.community.lede')}
            action={
              space.state === 'active' &&
              space.viewerRole !== null && (
                <button type="button" onClick={() => setContributing(true)} className={ghostPillSm}>
                  <Plus aria-hidden className="h-4 w-4" />
                  {t('demo.community.contribute')}
                </button>
              )
            }
          >
            {allContributions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
                <Sparkles aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
                <p className="mb-1.5 text-[15px] font-semibold">{t('demo.community.emptyTitle')}</p>
                <p className="mx-auto max-w-[44ch] text-[14px] leading-relaxed text-quiet">
                  {t('demo.community.emptyBody')}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {/*
                  A card that leaves is *seen* to leave. Promoting a
                  contribution moves it into the path and hiding one takes it
                  out of a Member's view — both remove it from this list, and
                  without an exit it blinked out of existence while its
                  neighbours jumped up to fill the gap. `popLayout` takes the
                  leaving card out of flow so the survivors slide rather than
                  snap.
                */}
                <AnimatePresence mode="popLayout" initial={false}>
                  {allContributions.map((c, i) => (
                    <motion.div
                      key={c.id}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      // Exit is the reverse of enter, slightly faster.
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.14 }}
                      className={
                        i === 0 && allContributions.length > 1 ? 'sm:col-span-2' : undefined
                      }
                    >
                      <ContributionCard
                        contribution={c}
                        space={space}
                        isOwn={c.author.id === viewer.id}
                        onModerated={() => setWriteTick((n) => n + 1)}
                        /* Likes sort this section — the top one should look it. */
                        featured={i === 0 && allContributions.length > 1}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </StageRow>
          </div>
        </>
      )}

      {/* ── Members ── */}
      {tab === 'members' && (
        <section className="mt-10">
          <h2 className="mb-6 text-[26px] font-medium tracking-[-0.02em]">
            {t('demo.members.title')}
            <span className="ml-2.5 tabular-nums text-quiet">{formatNumber(space.memberCount)}</span>
          </h2>
          {/* Who may publish and who can find it — reference facts, so they
              live here rather than in the first look. */}
          <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
            <ModeBadge mode={space.mode} />
            <VisibilityBadge visibility={space.visibility} />
          </div>

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
                ? t('demo.members.locked')
                : t('demo.members.alone')}
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
                    {t(ROLE_KEY[m.role])}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {members.length > 0 && members.length < space.memberCount && (
            <p className="mt-4 text-[13px] text-faint">
              {t('demo.members.showing', { shown: members.length, total: formatNumber(space.memberCount) })}
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
    </div>
    </div>,
  );
}
