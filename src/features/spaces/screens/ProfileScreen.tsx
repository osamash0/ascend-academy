import { Flame, Heart, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { libraryItems, viewerStanding } from '../mocks/library';
import { moments } from '../mocks/moments';
import { standingFor } from '../mocks/rank';
import { currentRun } from '../mocks/history';
import { viewer } from '../mocks/people';
import { visibleSpaces } from '../mocks/spaces';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Avatar, RankRing } from '../components/Avatar';
import { Scene, SURFACES } from '../components/Scene';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';
import { AscentMap, ascentSpaces } from '../components/AscentMap';
import { Sep, Skylight, StageRow, ghostPillSm, stageCard } from '../components/stage';

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
  const published = libraryItems().filter((i) => i.kind === 'contribution');
  const likesReceived = published.reduce((n, i) => n + (i.likeCount ?? 0), 0);

  // Profile stands on the stage. You are not a subject, so the light is the
  // brand's — neutral white — never a colour (monochrome brand).
  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.profile} status="progress" motionKey="profile" accent={null}>
      <SpacesTopBar active="profile" viewer={viewer} />
      <div className="relative">
        <Skylight accent={null} />
        {body}
      </div>
    </Scene>
  );

  // All four states. `?mock=loading|error` was a no-op on this screen.
  if (screenState === 'loading') return chrome(<ListSkeleton label="profile" />);
  if (screenState === 'error') return chrome(<SpacesError what="profile" />);

  return chrome(
    <>

      <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
        {/*
          ── You ──
          Each fact once, in its most visual form (Abi, 2026-10-10: the word
          "Rank" appeared four times on this screen). The ring IS the progress
          through your Rank; the number rides on it like a level on a game
          avatar; one quiet line says what is left. Settings is not repeated
          here — the gear in the top bar already goes there.
        */}
        <header className="flex flex-col items-center text-center">
          <Link
            to="/v4/profile/rank"
            aria-label={`Rank ${rank}. ${toNext} XP to the next Rank.`}
            className="console-focusable relative rounded-full"
          >
            <RankRing progress={pct}>
              <Avatar person={viewer} size="xl" isViewer />
            </RankRing>
            <span
              aria-hidden
              className="absolute -bottom-2 left-1/2 flex h-7 min-w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-black bg-white px-2 text-[13px] font-bold tabular-nums text-black"
            >
              {rank}
            </span>
          </Link>
          <h1 className="mt-7 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[60px]">
            {viewer.name}
          </h1>
          <p className="mt-3 text-[14px] tabular-nums text-quiet">
            {xp.toLocaleString()} XP<Sep />
            {toNext} to go
          </p>
        </header>

        {/*
          Three figures, not a bento. The old six cells repeated the masthead
          (Rank), the section below (Moments), the top bar (Spaces) and each
          other (Published and Likes opened the same page). What is left says
          something nothing else on the screen does.
        */}
        <div className="mx-auto mt-14 grid max-w-2xl grid-cols-3 divide-x divide-white/[0.08]">
          {[
            { to: '/v4/profile/history', n: streak, label: streak === 1 ? 'day in a row' : 'days in a row', icon: Flame },
            { to: '/v4/library/impact', n: published.length, label: 'published', icon: Sparkles },
            { to: '/v4/library/impact', n: likesReceived, label: likesReceived === 1 ? 'like' : 'likes', icon: Heart },
          ].map((f) => (
            <Link
              key={f.label}
              to={f.to}
              className="console-focusable group flex flex-col items-center gap-1.5 px-2 py-2 transition-colors"
            >
              <span className="text-[34px] font-medium leading-none tabular-nums tracking-[-0.02em] transition-colors group-hover:text-white">
                {f.n}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-quiet">
                <f.icon aria-hidden className="h-3.5 w-3.5" />
                {f.label}
              </span>
            </Link>
          ))}
        </div>

        <StageRow
          id="profile-journey"
          title="Your journey"
          lede="Every Space you are in, oldest first. Height is how far you have got."
        >
          {/*
            Abi's call, 2026-08-31: Ascent inherits the per-Space map's ten
            rules, scaled up a level — a body is a Space, its light is the
            fraction of its path you have cleared, and the palette is
            identical. Two maps with different colour meanings would be worse
            than one map.
          */}
          <AscentMap spaces={ascentSpaces(visibleSpaces())} />
        </StageRow>

        {/*
          The badge wall is gone — six rows, three of them padlocked goals.
          "Get 25 likes on your work" was an instruction to farm likes, which
          is what Doc 1 rule 3's anti-farming clauses exist to suppress. The
          full record lives on its own screen; this links to it rather than
          dangling anything.
        */}
        <StageRow
          id="profile-moments"
          title="Moments"
          count={allMoments.length}
          lede="The first time each thing happened. Not a set to complete."
          action={
            <Link to="/v4/profile/moments" className={ghostPillSm}>
              All moments
            </Link>
          }
        >
          <ul className="space-y-2.5">
            {allMoments.slice(-3).reverse().map((m) => (
              <li
                key={m.id}
                className={cn(stageCard, 'px-4 py-3.5')}
              >
                <p className="text-[14.5px] font-semibold">{m.title}</p>
                <p className="mt-1 text-[13px] text-quiet">{m.detail}</p>
              </li>
            ))}
          </ul>
        </StageRow>
      </div>
    </>,
  );
}
