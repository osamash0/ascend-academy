import { ArrowLeft, Flame } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { viewer } from '../mocks/people';
import {
  currentRun,
  daysStudied,
  lastStudied,
  longestRun,
  recentWeeks,
  studyDays,
  TODAY,
} from '../mocks/history';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { EnterGroup, EnterItem, EnterList, EnterListItem } from '../components/Enter';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';

/**
 * Study history — "which days did I actually work?"
 *
 * ## What this screen is not
 *
 * It is not a streak system. Abi's call, and the docs back it: **"streak"
 * appears in no design document**, it is absent from Doc 1 rule 6's list of
 * words we use, and rule 7 states that "XP and ranks carry all progression".
 * Engagement rule 4 puts it plainly — nothing gets "a second progression
 * bolted on".
 *
 * A count of consecutive days is a fact about what you did. A *streak system*
 * — milestones, freezes, a number you can lose — is a second currency beside
 * XP, and it is the one mechanic in this product that would work by making
 * people anxious rather than by helping them learn. So this screen reports and
 * does not push:
 *
 *   • no "don't break your streak", no countdown, no warning that a run is
 *     about to end;
 *   • no reward for length, because the reward would be the second
 *     progression the rules exclude;
 *   • days that have not happened yet are drawn as absent, not as missed. The
 *     calendar ends on the week containing today, so up to six cells are the
 *     rest of this week — shaded like unstudied days they would read as six
 *     failures already banked.
 *
 * The longest run is shown *beside* the current one deliberately. A single
 * number you might lose invites protecting it; the same number next to a
 * bigger one you already managed reads as history rather than as a stake.
 *
 * Learn mode: a record of you, calm and browsable.
 */

const formatDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

const formatShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export default function HistoryScreen() {
  const screenState = useScreenState();
  const run = currentRun();
  const best = longestRun();
  const total = daysStudied();
  const last = lastStudied();
  const weeks = recentWeeks();
  /** Newest first — the recent past is what anyone came here to read. */
  const days = [...studyDays].sort((a, b) => b.date.localeCompare(a.date));

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.profile} status="progress" motionKey="history">
      <SpacesTopBar active="profile" viewer={viewer} />
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<ListSkeleton label="Loading your history" />);
  if (screenState === 'error') return chrome(<SpacesError what="your study history" />);

  return chrome(
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-8 lg:px-8">
      <Link
        to="/v4/profile"
        className="console-focusable inline-flex items-center gap-2 rounded-full text-[13.5px] text-quiet transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Profile
      </Link>

      <EnterGroup>
        <EnterItem>
          <header className="mt-6">
            <p className="flex items-center gap-2 text-[13px] font-medium text-quiet">
              <Flame aria-hidden className="h-4 w-4" />
              Study history
            </p>
            <h1 className="mt-3 text-5xl font-bold tracking-[-0.02em] tabular-nums">
              {run} {run === 1 ? 'day' : 'days'} running
            </h1>
            <p className="mt-3 text-[15px] text-quiet">
              {/*
                Stated, not implied. "Longest run yet" sat under the current
                number on Profile and was simply false whenever an earlier run
                had been longer — which it had.
              */}
              Longest so far, {best} {best === 1 ? 'day' : 'days'} · {total} days studied in all
            </p>
            {last && (
              <p className="mt-2 text-[13px] text-faint">
                {last === TODAY ? 'Including today.' : `Last on ${formatDay(last)}.`}
              </p>
            )}
          </header>
        </EnterItem>

        <EnterItem>
          <section className="mt-9">
            <h2 className="text-[15px] font-semibold">The last six weeks</h2>
            <div className="mt-4 flex flex-col gap-1.5">
              {weeks.map((week) => (
                <div key={week[0].date} className="flex gap-1.5">
                  {week.map((d) =>
                    d.future ? (
                      // Absent, not empty — a day that has not happened is not
                      // a day you missed.
                      <div key={d.date} aria-hidden className="h-7 w-7" />
                    ) : (
                      <div
                        key={d.date}
                        title={`${formatShort(d.date)} — ${d.studied ? 'studied' : 'no study'}`}
                        className={cn(
                          'h-7 w-7 rounded-[7px] border',
                          d.studied
                            ? 'border-primary/30 bg-primary/60'
                            : 'border-white/[0.08] bg-white/[0.03]',
                        )}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
            {/*
              One shade for "studied", not five for "how hard". Grading the
              colour by volume turns a record into a scoreboard and quietly
              rewards long days — the second progression again, in CSS.
            */}
            <p className="mt-3 text-[12.5px] text-faint">
              A filled square is a day you studied. Nothing here counts toward XP or your
              Rank.
            </p>
          </section>
        </EnterItem>

        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">Every day you studied</h2>
        </EnterItem>
      </EnterGroup>

      <EnterList whenVisible className="mt-4 space-y-2">
        {days.map((d) => (
          <EnterListItem
            key={d.date}
            className="flex items-baseline gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3.5"
          >
            <span className="w-24 shrink-0 text-[13px] text-quiet tabular-nums">
              {formatShort(d.date)}
            </span>
            <p className="min-w-0 flex-1 text-[14px] leading-snug">{d.summary}</p>
          </EnterListItem>
        ))}
      </EnterList>
    </div>,
  );
}
