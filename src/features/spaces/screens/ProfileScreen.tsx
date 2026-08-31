import { Award, Check, Flame, Heart, Lock, Orbit, Settings, Sparkles, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { badges, libraryItems } from '../mocks/library';
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

const XP_IN_RANK = 250;
/** Mock. Typed as number, not the literal, so the plural check stays honest. */
const STREAK: number = 4;

export default function ProfileScreen() {
  const screenState = useScreenState();
  const xp = 60;
  const rank = 1;
  const intoRank = xp % XP_IN_RANK;
  const pct = Math.round((intoRank / XP_IN_RANK) * 100);

  const earned = badges.filter((b) => b.earned);
  const published = libraryItems().filter((i) => i.kind === 'contribution');
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
              {XP_IN_RANK - intoRank} XP to Rank {rank + 1}
            </p>
          </BentoCell>

          <BentoCell icon={Flame} label="Streak">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {STREAK}
              <span className="ml-1.5 text-[16px] text-quiet">
                {STREAK === 1 ? 'day' : 'days'}
              </span>
            </p>
            <p className="mt-2 text-[13px] text-quiet">Longest run yet</p>
          </BentoCell>

          <BentoCell icon={Award} label="Badges">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {earned.length}
              <span className="text-[18px] text-quiet">/{badges.length}</span>
            </p>
            {/* One dot per badge, filled as earned — the same gauge idea the
                map uses for Concepts. */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {badges.map((b) => (
                <span
                  key={b.id}
                  title={b.name}
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    b.earned ? 'bg-success' : 'border border-white/20 bg-transparent',
                  )}
                />
              ))}
            </div>
          </BentoCell>

          <BentoCell icon={Orbit} label="Spaces">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {mySpaces.length}
            </p>
            <p className="mt-2 text-[13px] text-quiet">Created and joined</p>
          </BentoCell>

          <BentoCell icon={Sparkles} label="Published">
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {published.length}
            </p>
            <p className="mt-2 text-[13px] text-quiet">Contributions you made</p>
          </BentoCell>

          {/* A fact about your work, never a second progression. */}
          <BentoCell icon={Heart} label="Likes received" className="sm:col-span-2">
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

        <section className="mt-10">
          <h2 className="mb-1 text-[14px] font-medium text-quiet">
            Badges
            <span className="ml-2 text-quiet tabular-nums">
              {earned.length}/{badges.length}
            </span>
          </h2>
          <p className="mb-4 text-[13.5px] text-faint">
            Each one says what earned it — nothing here is decoration.
          </p>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {badges.map((b) => (
              <li
                key={b.id}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border px-4 py-3.5',
                  b.earned
                    ? 'border-white/[0.10] bg-white/[0.04]'
                    : 'border-dashed border-white/[0.10] bg-transparent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                    b.earned ? 'bg-success/15 text-success' : 'bg-white/[0.05] text-faint',
                  )}
                >
                  {b.earned ? (
                    <Check aria-hidden className="h-4 w-4" />
                  ) : (
                    <Lock aria-hidden className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-[14.5px] font-semibold',
                      b.earned ? 'text-foreground' : 'text-quiet',
                    )}
                  >
                    {b.name}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-faint">{b.how}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>,
  );
}
