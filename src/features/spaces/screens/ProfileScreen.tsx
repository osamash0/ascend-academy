import { Award, Check, Flame, Heart, Lock, Orbit, Settings, Sparkles, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { libraryItems, viewerStanding } from '../mocks/library';
import { moments } from '../mocks/moments';
import { standingFor } from '../mocks/rank';
import { currentRun, longestRun } from '../mocks/history';
import { viewer } from '../mocks/people';
import { mySpaces, visibleSpaces } from '../mocks/spaces';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Avatar, RankRing } from '../components/Avatar';
import { BentoCell } from '../components/BentoCell';
import { Scene, SURFACES } from '../components/Scene';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';
import { AscentMap, ascentSpaces } from '../components/AscentMap';

/**
 * Profile — "how far have I come?"
 *
 * Your Ascent: XP, Rank, badges and your journey.
 *
 * **No star currency.** Doc 1 rule 7 forbids it — XP and Ranks carry all
 * progression, and stars belong to Spaces as a content signal. So nothing on
 * this screen counts stars or likes as a score. Likes appear only as "work of
 * yours that landed", which is a fact about your contributions, not a currency.
 *
 * A public profile is a subset of this same screen with the private parts
 * removed — not a second design. Settings is a Studio screen reached from here,
 * never a sixth destination.
 */



export default function ProfileScreen() {
  const screenState = useScreenState();
  /*
   * From the one standing, not from two literals sitting here.
   *
   * This screen carried `const xp = 60; const rank = 1;` and never read the
   * leaderboard — so Profile, the top bar and Social each stated the viewer's
   * rank independently, and the local `XP_IN_RANK = 250` drove a progress bar
   * on a fourth curve that matched none of them.
   */
  const { xp } = viewerStanding();
  const { rank, toNext, pct } = standingFor(xp);
  const streak = currentRun();

  const allMoments = moments();
  const latestMoment = [...allMoments].reverse().find((m) => m.at !== null) ?? allMoments[0];
  const published = libraryItems.filter((i) => i.kind === 'contribution');
  const likesReceived = published.reduce((n, i) => n + (i.likeCount ?? 0), 0);

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.profile} status="progress" motionKey="profile">
      <SpacesTopBar active="profile" viewer={viewer} />
      {body}
    </Scene>
  );

  // All four states. `?mock=loading|error` was a no-op on this screen.
  if (screenState === 'loading') return chrome(<ListSkeleton label="Loading profile" />);
  if (screenState === 'error') return chrome(<SpacesError what="your profile" />);

  return chrome(
    <>

      <div className="mx-auto max-w-5xl px-6 pb-24 pt-8 lg:px-8">
        <header className="flex flex-wrap items-center gap-5">
          {/* The ring is the gauge: progress through this Rank, drawn around
              the face rather than reported as a second number. */}
          <RankRing progress={pct}>
            <Avatar person={viewer} size="xl" isViewer />
          </RankRing>
          <div className="min-w-0">
            <h1 className="text-4xl font-bold tracking-[-0.02em]">{viewer.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-quiet tabular-nums">
              <span className="font-semibold text-primary">Rank {rank}</span>
              <span aria-hidden className="text-faint">·</span>
              <span>{xp.toLocaleString()} XP</span>
            </p>
          </div>
          <Link
            to="/v4/settings"
            className="console-focusable ml-auto flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
          >
            <Settings aria-hidden className="h-3.5 w-3.5" />
            Settings
          </Link>
        </header>

        {/*
          The bento. Profile was already five discrete stats laid out as a
          linear page — Rank, streak, Spaces, published work, likes received.
          The PS5 home reports exactly this kind of thing as widgets: one
          figure, plainly, at the size its importance deserves.

          Rank takes the widest span because Doc 1 rule 7 makes it the only
          progression there is. There is no star currency here and no second
          score bolted on: likes appear as a fact about your work, not a rank.
        */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BentoCell
            icon={TrendingUp}
            label="Rank"
            className="sm:col-span-2"
            to="/v4/profile/rank"
            art={
              <div className="absolute inset-0 bg-gradient-to-l from-primary/35 via-secondary/20 to-transparent" />
            }
          >
            <p className="text-[30px] font-semibold leading-none">
              Rank {rank}
              <span className="ml-2 text-[17px] text-quiet tabular-nums">
                {xp.toLocaleString()} XP
              </span>
            </p>
            <div className="mt-4 h-2 w-full max-w-[16rem] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[12.5px] text-faint tabular-nums">
              {toNext} XP to Rank {rank + 1}
            </p>
          </BentoCell>

          <BentoCell icon={Flame} label="Streak" to="/v4/profile/history">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {streak}
              <span className="ml-1.5 text-[16px] text-quiet">
                {streak === 1 ? 'day' : 'days'}
              </span>
            </p>
            {/* Was "Longest run yet" under the *current* number — false as soon as an
                earlier run was longer, which it is: four now, six in August. */}
          <p className="mt-2 text-[13px] text-quiet">Longest so far, {longestRun()} days</p>
          </BentoCell>

          {/*
            Was `3/6` with a filled dot per badge — a completion gauge, which
            is the second progression rule 4 excludes from the Ascent profile.
            A moment has no total, so this names the most recent one instead.
          */}
          <BentoCell icon={Award} label="Moments" to="/v4/profile/moments">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {allMoments.length}
            </p>
            <p className="mt-2 line-clamp-2 text-[13px] text-quiet">
              {latestMoment ? latestMoment.title : 'Nothing yet'}
            </p>
          </BentoCell>

          {/* The hub lists exactly what this counts, so the number is a door. */}
          <BentoCell icon={Orbit} label="Spaces" to="/v4/spaces">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {mySpaces.length}
            </p>
            <p className="mt-2 text-[13px] text-quiet">Created and joined</p>
          </BentoCell>

          {/*
            "How your work landed" *is* this number itemised — every
            contribution you published, with what happened to it. Counting
            something on one screen and detailing it on another, with no way
            across, was the gap.
          */}
          <BentoCell icon={Sparkles} label="Published" to="/v4/library/impact">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {published.length}
            </p>
            <p className="mt-2 text-[13px] text-quiet">Contributions you made</p>
          </BentoCell>

          {/* A fact about your work, never a second progression. */}
          {/* Same destination: impact rows carry the per-item likes this sums. */}
          <BentoCell
            icon={Heart}
            label="Likes received"
            className="sm:col-span-2"
            to="/v4/library/impact"
          >
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {likesReceived}
            </p>
            <p className="mt-2 text-[13px] text-quiet">
              What other people found useful. XP carries progression, not this.
            </p>
          </BentoCell>
        </div>

        <section className="mt-10">
          <h2 className="mb-1 text-[14px] font-medium text-quiet">Your journey</h2>
          <p className="mb-4 text-[13.5px] text-faint">
            Every Space you are in, oldest first. Height is how far you have got.
          </p>
          {/*
            Abi's call, 2026-08-31: Ascent inherits the per-Space map's ten
            rules, scaled up a level — a body is a Space, its light is the
            fraction of its path you have cleared, and the palette is
            identical. Two maps with different colour meanings would be worse
            than one map.
          */}
          <AscentMap spaces={ascentSpaces(visibleSpaces())} />
        </section>

        {/*
          The badge wall is gone — six rows, three of them padlocked goals.
          "Get 25 likes on your work" was an instruction to farm likes, which
          is what Doc 1 rule 3's anti-farming clauses exist to suppress. The
          full record lives on its own screen; this links to it rather than
          dangling anything.
        */}
        <section className="mt-10">
          <h2 className="mb-1 text-[14px] font-medium text-quiet">Moments</h2>
          <p className="mb-4 text-[13.5px] text-faint">
            The first time each thing happened. Not a set to complete.
          </p>
          <ul className="space-y-2.5">
            {allMoments.slice(-3).reverse().map((m) => (
              <li
                key={m.id}
                className="rounded-2xl border border-white/[0.10] bg-white/[0.04] px-4 py-3.5"
              >
                <p className="text-[14.5px] font-semibold">{m.title}</p>
                <p className="mt-1 text-[13px] text-quiet">{m.detail}</p>
              </li>
            ))}
          </ul>
          <Link
            to="/v4/profile/moments"
            className="console-focusable mt-4 inline-flex items-center gap-2 rounded-full text-[13.5px] text-quiet transition-colors hover:text-foreground"
          >
            All moments
          </Link>
        </section>
      </div>
    </>,
  );
}
