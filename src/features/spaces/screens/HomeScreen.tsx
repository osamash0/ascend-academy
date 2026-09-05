import { Flame, PartyPopper, Play, Plus, RotateCw, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Pressable, PressableLink } from '../components/Pressable';
import { gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import { BentoCell } from '../components/BentoCell';
import { LessonTile } from '../components/LessonTile';
import type { HomeItem } from '../mocks/library';
import { useHome } from '../data/useSpaces';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { JoinSpaceDialog, NewSpaceDialog } from '../components/SpaceDialogs';
import { SpacesError, SpacesSkeleton } from '../components/states';

/**
 * Home — "what do I do now?"
 *
 * Your next action, assembled across every Space. The landing screen after
 * login and the daily driver.
 *
 * The rule that shapes it: **Home links to Lessons and practice, never to a
 * Space card.** A Home item names its Space as context and opens the Lesson.
 * Home ranks across all Spaces and answers "the one thing"; the Spaces list
 * shows per-Space progress and resumes that Space. Same information at two
 * altitudes — Home is a decision, a Space card is a status.
 *
 * Learn mode: this is where a tired person lands, so it stays calm. One
 * primary action, and everything else subordinate to it.
 */

/**
 * What a row *is*. Every entry names a state, never an instruction.
 *
 * `continue` used to read "Pick up where you left off", and that one word of
 * difference put the same sentence on two items at once: the hero said it about
 * `Basics`, and a row in "Also waiting" said it about `Differential
 * Cryptanalysis`. Both were true — you can be part-way through two Lessons —
 * which is why the fix is not to drop one of them. The hero's Lesson was never
 * in the feed to begin with, so there was nothing to deduplicate.
 *
 * The tell is the register. "Up next", "Due for review" and "New since you were
 * here" all name a state; "Pick up where you left off" issues a command. It was
 * written for the hero, where an instruction is exactly right, and then reused
 * as a row label by one shared map read at two altitudes. A list says what
 * something is and lets you choose; the hero says what to do, because its whole
 * job is to be "the one thing".
 */
const REASON_LABEL: Record<HomeItem['reason'], string> = {
  continue: 'In progress',
  next: 'Up next',
  review: 'Due for review',
  new: 'New since you were here',
};

/**
 * What the hero says instead, where it differs.
 *
 * Only `continue` needs its own phrasing — the other three read the same at
 * either altitude, and duplicating them here would create the second place that
 * can disagree. Falls back to `REASON_LABEL`, so a new reason is a row label
 * first and gains a hero voice only if it earns one.
 */
const HERO_LABEL: Partial<Record<HomeItem['reason'], string>> = {
  continue: 'Pick up where you left off',
};

const heroLabel = (reason: HomeItem['reason']) => HERO_LABEL[reason] ?? REASON_LABEL[reason];

const REASON_ICON: Record<HomeItem['reason'], typeof Play> = {
  continue: Play,
  next: Play,
  review: RotateCw,
  new: Sparkles,
};

/** Mock progression — the real values come from the XP engine later. */
const RANK = 'Rank 1';
const XP = 60;
const XP_PER_RANK = 250;

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function HomeScreen() {
  const navigate = useNavigate();
  const { state, kind, next, feed, recent, streakDays } = useHome();
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  /** The most recent thing you touched — the target for "Review something". */
  const lastTouched = recent[0] ?? feed[0];

  /*
   * Derived from `feed` and nothing else. A cell that states a count must open
   * the thing it counted, so each keeps its first item rather than just a
   * length — otherwise the number and the destination are two facts that can
   * disagree, which is the §A failure this screen already had once.
   */
  const due = feed.filter((i) => i.reason === 'review');
  const dueForReview = due.length;
  const firstDue = due[0];
  const fresh = feed.filter((i) => i.reason === 'new');
  const newCount = fresh.length;
  const newest = fresh[0];

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.home} status="progress" motionKey="home">
      <SpacesTopBar active="home" viewer={viewer} />
      {body}
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="your next thing" />);

  // Brand-new account: nothing to continue. One action, join or create — and
  // this is the only place Home may point at Spaces rather than a Lesson,
  // because there is no Lesson to point at yet.
  const NextIcon = next ? topicIcon(next.lessonTitle, next.lessonId) : Play;

  if (kind === 'review' && next) {
    return chrome(
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16 text-center lg:px-8">
        <PartyPopper aria-hidden className="mx-auto mb-5 h-9 w-9 text-xp" />
        <h1 className="text-3xl font-bold tracking-[-0.02em]">
          You are caught up, {viewer.name}
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15.5px] leading-[1.75] text-quiet">
          Everything in your Spaces is done. Nothing is waiting — come back when
          something new is published, or go back over what you have already cleared.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {/* Reviewing means reopening something you have finished. With
              nothing left to do, the most recent thing you touched is the
              honest target. */}
          <Pressable
            type="button"
            onClick={() =>
              navigate(
                lastTouched
                  ? `/v4/space/${lastTouched.spaceId}/lesson/${lastTouched.lessonId}`
                  : '/v4/spaces',
              )
            }
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-slate-900"
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            Review something
          </Pressable>
          <button
            type="button"
            onClick={() => navigate('/v4/spaces')}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium text-foreground transition-colors hover:bg-white/[0.08]"
          >
            Find another Space
          </button>
        </div>
      </div>,
    );
  }

  if (!next) {
    return chrome(
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-[-0.02em]">
          {greeting()}, {viewer.name}
        </h1>
        <p className="mb-8 max-w-[46ch] text-[15.5px] leading-[1.75] text-quiet">
          Nothing to pick up yet. Start a Space for something you’re learning, or join one
          with a code from someone else.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Pressable
            type="button"
            onClick={() => setNewOpen(true)}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-slate-900"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Create a Space
          </Pressable>
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium text-foreground transition-colors hover:bg-white/[0.08]"
          >
            Join with a code
          </button>
        </div>
        <NewSpaceDialog open={newOpen} onOpenChange={setNewOpen} />
        <JoinSpaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
      </div>,
    );
  }

  return chrome(
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">
          {greeting()}, {viewer.name}
        </h1>
      </div>

      {/*
        The bento. Read from the PS5 home: heterogeneous cells, the one thing
        you should do next given the widest span and its own art, and the
        supporting numbers reported the way the console reports storage or
        trophies — one figure, plainly.

        Doc 2: "Home links to Lessons and practice, never to a Space card." A
        cell names its Space as context; none of them is a way *into* a Space.

        Every cell that *carries* a Lesson opens it, by `to` — the hero, Due for
        review and New since you were here. Streak and Rank carry no Lesson, so
        they stay plain `div`s: a readout, not a control. Nothing here invents a
        destination it does not have.

        This comment used to read "every cell here opens a Lesson or practice",
        and not one of the five passed anything. `BentoCell` picks its tag from
        those props, so the hero — the largest thing on the landing screen, the
        "one thing" — rendered as a `div`: unreachable by keyboard, inert on
        click, while every smaller item on the page opened fine. The rule was
        written here and enforced nowhere, which is CYCLE.md §E. Note the shape
        of the miss: `deadends.test.tsx` asks whether every `<button>` has a
        handler, so a control that was never made a button in the first place
        walks straight past it. `openable.test.tsx` is the gate that does see it.
      */}
      <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BentoCell
          icon={Play}
          label={heroLabel(next.reason)}
          className="sm:col-span-2"
          to={`/v4/space/${next.spaceId}/lesson/${next.lessonId}`}
          art={
            <>
              <div
                className={cn('absolute inset-0 bg-gradient-to-l opacity-35', gradientFor(next.lessonOrder))}
              />
              <NextIcon aria-hidden className="absolute right-5 top-1/2 h-20 w-20 -translate-y-1/2 text-white/10" />
            </>
          }
        >
          {/* The Space is context, not a destination. */}
          <p className="text-[12.5px] text-faint">
            {next.spaceName} · Lesson {next.lessonOrder}
          </p>
          <p className="mt-1 line-clamp-2 pr-24 text-[20px] font-semibold leading-snug">
            {next.lessonTitle}
          </p>
          {next.percentComplete > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1 w-full max-w-[13rem] overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                  style={{ width: `${next.percentComplete}%` }}
                />
              </div>
              <span className="shrink-0 text-[12.5px] text-quiet tabular-nums">
                {next.percentComplete}%
              </span>
            </div>
          )}
        </BentoCell>

        <BentoCell icon={Flame} label="Streak">
          <p className="text-[28px] font-semibold leading-none tabular-nums">
            {streakDays}
            <span className="ml-1.5 text-[16px] text-quiet">
              {streakDays === 1 ? 'day' : 'days'}
            </span>
          </p>
          <p className="mt-2 text-[13px] text-quiet">Keep it going today</p>
        </BentoCell>

        <BentoCell icon={TrendingUp} label="Rank">
          <p className="text-[28px] font-semibold leading-none tabular-nums">
            {RANK}
            <span className="ml-1.5 text-[16px] text-quiet">{XP} XP</span>
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
              style={{ width: `${Math.round((XP / XP_PER_RANK) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-faint tabular-nums">
            {XP_PER_RANK - XP} XP to the next rank
          </p>
        </BentoCell>

        {dueForReview > 0 && firstDue && (
          <BentoCell
            icon={RotateCw}
            label="Due for review"
            className="sm:col-span-2"
            to={`/v4/space/${firstDue.spaceId}/lesson/${firstDue.lessonId}`}
          >
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {dueForReview}
              <span className="ml-1.5 text-[16px] text-quiet">
                {dueForReview === 1 ? 'Lesson' : 'Lessons'}
              </span>
            </p>
            <p className="mt-2 text-[13px] text-quiet">
              Spaced out so it sticks. A few minutes is enough.
            </p>
          </BentoCell>
        )}

        {newCount > 0 && newest && (
          <BentoCell
            icon={Sparkles}
            label="New since you were here"
            className="sm:col-span-2"
            to={`/v4/space/${newest.spaceId}/lesson/${newest.lessonId}`}
          >
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {newCount}
              <span className="ml-1.5 text-[16px] text-quiet">
                {newCount === 1 ? 'Lesson' : 'Lessons'}
              </span>
            </p>
            {/* Naming the latest is what makes the cell openable honestly: the
                destination is the Lesson the copy just named. */}
            <p className="mt-2 line-clamp-1 text-[13px] text-quiet">
              Latest: {newest.lessonTitle} · {newest.spaceName}
            </p>
          </BentoCell>
        )}
      </div>

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="mt-10">
          <h2 id="recent-heading" className="mb-4 text-[14px] font-medium text-quiet">
            Recently viewed
          </h2>
          {/* A rail, like the Spaces rows — and Lesson-level, like everything
              else on Home. Excludes whatever "Continue" already offers. */}
          <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.map((r) => {
              const Icon = topicIcon(r.lessonTitle, r.lessonId);
              return (
                /*
                 * A link, not a button. Both opened the Lesson, but these four
                 * covers were the only Lesson targets on Home that carried no
                 * `href` — "Also waiting" below is already `<Link>`. So the
                 * same act had two implementations, and the button half lost
                 * cmd-click, middle-click, open-in-new-tab and the status-bar
                 * preview. `PressableLink` keeps the identical press feel and
                 * was already in use on three other screens; Home was the
                 * outlier, not the pattern.
                 */
                <PressableLink
                  key={r.lessonId}
                  to={`/v4/space/${r.spaceId}/lesson/${r.lessonId}`}
                  aria-label={`${r.lessonTitle}, Lesson ${r.lessonOrder} in ${r.spaceName}`}
                  className="console-focusable block h-[150px] w-[13.5rem] shrink-0 rounded-2xl text-left"
                >
                  {/*
                    Cover art, not a plain card. `LessonTile` existed, matched
                    this product's console language, and nothing in the repo
                    imported it — so its progress bar, its watermark and its
                    "Done" badge had never rendered against anything. A
                    component with no call site is written, not built.
                  */}
                  <LessonTile
                    title={r.lessonTitle}
                    eyebrow={r.spaceName}
                    gradientIndex={r.lessonOrder}
                    progress={r.percentComplete}
                    done={r.percentComplete === 100}
                    watermark={<Icon aria-hidden className="h-16 w-16 text-white/[0.10]" />}
                  />
                </PressableLink>
              );
            })}
          </div>
        </section>
      )}

      {/* Everything else, still Lesson-level. Never a Space card. */}
      {feed.length > 0 && (
        <section aria-labelledby="feed-heading" className="mt-10">
          <h2 id="feed-heading" className="mb-3 text-[15px] font-semibold">
            Also waiting
          </h2>
          <ul className="space-y-2.5">
            {feed.map((item) => {
              const Icon = REASON_ICON[item.reason];
              return (
                <li key={`${item.lessonId}-${item.reason}`}>
                  <article className="group relative flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 transition-colors hover:bg-white/[0.05]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-quiet">
                      <Icon aria-hidden className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-faint">{REASON_LABEL[item.reason]}</p>
                      <h3 className="mt-0.5 truncate text-[15.5px] font-semibold">
                        {item.lessonTitle}
                      </h3>
                      {/* Context, not an entry point. */}
                      <p className="mt-0.5 text-[13px] text-quiet">
                        {item.spaceName} · Lesson {item.lessonOrder}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-quiet transition-colors sm:flex',
                        'group-hover:bg-white/[0.12]',
                      )}
                    >
                      <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
                    </span>
                    {/* The whole card is the target — it announced itself as
                        one and had no handler. The rail above it navigated
                        correctly, so this was one live row pattern and one
                        dead one on the same screen. */}
                    <Link
                      to={`/v4/space/${item.spaceId}/lesson/${item.lessonId}`}
                      className="console-focusable absolute inset-0 rounded-2xl"
                      aria-label={`${REASON_LABEL[item.reason]}: ${item.lessonTitle}, Lesson ${item.lessonOrder} in ${item.spaceName}`}
                    >
                      <span className="sr-only">Open</span>
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>,
  );
}
