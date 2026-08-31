import { ArrowLeft, BookOpen, Check, Heart, Sparkles, Star, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { viewer } from '../mocks/people';
import { viewerStanding } from '../mocks/library';
import {
  standingFor,
  xpBySource,
  xpEvents,
  xpForRank,
  type XpSource,
} from '../mocks/rank';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { EnterGroup, EnterItem, EnterList, EnterListItem } from '../components/Enter';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';

/**
 * Rank — "why is this number what it is?"
 *
 * Profile reports a rank; this screen is the only place that explains one. It
 * exists because the Rank cell was a readout with nowhere to go, and the
 * honest reason it had nowhere to go was that nothing in the product could
 * answer the obvious next question.
 *
 * ## What it is allowed to show
 *
 * Doc 1, Engagement rule 4 is absolute: **"Ranks and the Ascent profile read
 * from XP only. Likes and stars are content signals; they don't have a second
 * progression bolted on."** So there is no like count, no star count and no
 * second bar anywhere here. Every number on this screen is XP or a rank.
 *
 * ## Why a ledger rather than a trophy case
 *
 * The rule people actually trip over is rule 2: **XP is engagement-gated.**
 * It is granted when a contribution is liked, endorsed or used — *never per
 * post*. Somebody who publishes five things and earns nothing has met a rule
 * the product never stated, and will read it as the product being broken.
 *
 * So the centre of this screen is where the XP came from, itemised, and a
 * plain statement of what earns nothing. That is the one thing a rank screen
 * can say that the Rank cell cannot, and it turns an opaque number into a
 * record of things the person actually did.
 *
 * Learn mode: a record of you, calm and browsable. No tables, no multi-select,
 * nothing to manage — the Studio screens are where dense work happens.
 */

const SOURCE_LABEL: Record<XpSource, string> = {
  learning: 'Learning',
  liked: 'Liked by someone',
  endorsed: 'Endorsed by an Owner',
  used: 'Used by someone',
  milestone: 'Milestone',
};

const SOURCE_ICON: Record<XpSource, typeof BookOpen> = {
  learning: BookOpen,
  liked: Heart,
  endorsed: Check,
  used: Sparkles,
  milestone: Star,
};

/**
 * What each source means, in the person's terms.
 *
 * Written out because "Used" is meaningless on its own, and Doc 1 defines it
 * narrowly — v1 has exactly one "used" event and pretending otherwise would
 * promise something the product does not do.
 */
const SOURCE_MEANING: Record<XpSource, string> = {
  learning: 'Finishing Lessons and practice in any Space.',
  liked: 'Someone found a contribution of yours useful.',
  endorsed: 'An Owner marked your work as worth trusting.',
  used: 'Someone completed a practice set you wrote.',
  milestone: 'Your first contribution — once ever, not once per Space.',
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function RankScreen() {
  const screenState = useScreenState();
  const { xp } = viewerStanding();
  const { rank, into, span, toNext, pct } = standingFor(xp);
  const bySource = xpBySource();
  /** Newest first: what you did most recently is what you are asking about. */
  const events = [...xpEvents].sort((a, b) => b.at.localeCompare(a.at));

  /*
   * The ladder shown around you, not from Rank 1.
   *
   * Drawing every rank from the first would be a wall of ticks with the
   * interesting part — where you are and what is next — buried in it.
   */
  const ladder = [rank - 1, rank, rank + 1, rank + 2].filter((n) => n >= 1);

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.profile} status="progress" motionKey="rank">
      <SpacesTopBar active="profile" viewer={viewer} />
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<ListSkeleton label="Loading your rank" />);
  if (screenState === 'error') return chrome(<SpacesError what="your rank" />);

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
              <TrendingUp aria-hidden className="h-4 w-4" />
              Rank
            </p>
            <h1 className="mt-3 text-5xl font-bold tracking-[-0.02em] tabular-nums">
              Rank {rank}
            </h1>
            <p className="mt-3 text-[15px] text-quiet tabular-nums">
              {xp.toLocaleString()} XP · {toNext.toLocaleString()} to Rank {rank + 1}
            </p>

            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress through Rank ${rank}`}
              className="mt-5 h-2 w-full max-w-md overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[12.5px] text-faint tabular-nums">
              {into.toLocaleString()} of {span.toLocaleString()} XP through this rank
            </p>
          </header>
        </EnterItem>

        {/*
          The gate, stated before the ledger rather than after it. Somebody
          arrives here because a number surprised them; the answer should be
          above the evidence, not underneath it.
        */}
        <EnterItem>
          <section className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5">
            <h2 className="text-[15px] font-semibold">XP comes from being useful</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-quiet">
              Learning earns it, and so does work of yours that someone liked, an Owner
              endorsed, or someone used. Publishing on its own earns nothing — otherwise
              the fastest way up would be to post constantly, and the Spaces would fill
              with noise.
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-quiet">
              Likes from people who have not learned anything in that Space still count
              toward the contribution, but grant no XP. You cannot like your own work.
            </p>
          </section>
        </EnterItem>

        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">Where yours came from</h2>
        </EnterItem>

        <EnterItem>
          <div className="mt-4 space-y-2">
            {bySource.map((s) => {
              const Icon = SOURCE_ICON[s.source];
              const share = Math.round((s.total / xp) * 100);
              return (
                <div
                  key={s.source}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon aria-hidden className="h-4 w-4 text-quiet" />
                    <span className="text-[14px] font-medium">{SOURCE_LABEL[s.source]}</span>
                    <span className="ml-auto text-[15px] font-semibold tabular-nums">
                      {s.total} XP
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-quiet">{SOURCE_MEANING[s.source]}</p>
                  {/*
                    A share of *this* total, not a second progression — Doc 1
                    rule 4. It says how one number was made up, and it moves
                    only because XP moved.
                  */}
                  <div
                    aria-hidden
                    className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
                  >
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </EnterItem>

        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">Everything that earned it</h2>
        </EnterItem>
      </EnterGroup>

      <EnterList whenVisible className="mt-4 space-y-2">
        {events.map((e) => {
          const Icon = SOURCE_ICON[e.source];
          return (
            <EnterListItem
              key={e.id}
              className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3.5"
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-snug">{e.label}</p>
                <p className="mt-1 text-[12.5px] text-faint">
                  {/* An account-wide event names no Space, and must not
                      invent one — the orphan row's mistake. */}
                  {[e.spaceName, formatWhen(e.at)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums text-primary">
                +{e.amount}
              </span>
            </EnterListItem>
          );
        })}
      </EnterList>

      <EnterGroup whenVisible>
        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">What is ahead</h2>
        </EnterItem>
        <EnterItem>
          <ol className="mt-4 space-y-1.5">
            {ladder.map((n) => {
              const reached = n <= rank;
              const current = n === rank;
              return (
                <li
                  key={n}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border px-5 py-3',
                    current
                      ? 'border-primary/30 bg-primary/[0.07]'
                      : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'text-[14px] font-medium tabular-nums',
                      reached ? 'text-foreground' : 'text-quiet',
                    )}
                  >
                    Rank {n}
                  </span>
                  {current && (
                    <span className="text-[12.5px] font-medium text-primary">You are here</span>
                  )}
                  <span className="ml-auto text-[13px] text-faint tabular-nums">
                    {n <= 1 ? 'from the start' : `${xpForRank(n).toLocaleString()} XP`}
                  </span>
                </li>
              );
            })}
          </ol>
        </EnterItem>
      </EnterGroup>
    </div>,
  );
}
