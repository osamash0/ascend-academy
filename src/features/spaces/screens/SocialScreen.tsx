import { useState } from 'react';
import { Check, Search, Trophy, UserPlus, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { friendRequests, friends, leaderboard } from '../mocks/library';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { AuthorLine } from '../components/badges';
import { BentoCell } from '../components/BentoCell';

/**
 * Social — "who else, and how am I doing?"
 *
 * People, and only people: friends, requests, finding people, their public
 * profiles, and rankings. **Social shows no Space cards and no Lessons.** Where
 * a person's work is mentioned the link goes to that work in its Space; here,
 * a shared Space is context on a person, never an entry point.
 *
 * Rankings read **XP only**. Doc 1 locks it: ranks and progression read from
 * XP; likes and stars are content signals with no second progression bolted
 * on. So there is no star count and no like count anywhere on this screen.
 *
 * Learn mode.
 */

type Tab = 'ranking' | 'friends' | 'requests';

export default function SocialScreen() {
  const [tab, setTab] = useState<Tab>('ranking');

  const myPosition = leaderboard.findIndex((r) => r.isViewer) + 1;
  const me = leaderboard.find((r) => r.isViewer);
  /** The person immediately above you — the only gap worth reporting. */
  const ahead = leaderboard[myPosition - 2];

  return (
    <Scene surface={SURFACES.social} status="progress" motionKey="social">
      <SpacesTopBar active="social" viewer={viewer} />

      <div className="mx-auto max-w-5xl px-6 pb-24 pt-8 lg:px-8">
        <header className="space-y-3">
          <h1 className="text-4xl font-bold tracking-[-0.02em] sm:text-[44px]">Social</h1>
          <p className="max-w-[54ch] text-[15.5px] leading-[1.75] text-quiet">
            The people you’re learning alongside, and where you stand.
          </p>
        </header>

        {/*
          At a glance, then the roster. The bento reports the facts — where you
          stand, who is waiting — the way the console reports trophies or online
          friends. The people themselves stay a list: a roster is a chronology
          of names, and turning names into widgets would make them decorative.

          Doc 2: Social shows no Space cards and no Lessons. "Spaces in common"
          below is a count on a person, not a way into a Space.
        */}
        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BentoCell
            icon={Trophy}
            label="Where you stand"
            className="sm:col-span-2"
            art={
              <div className="absolute inset-0 bg-gradient-to-l from-primary/30 via-secondary/15 to-transparent" />
            }
          >
            <p className="text-[30px] font-semibold leading-none tabular-nums">
              #{myPosition}
              <span className="ml-2 text-[17px] text-quiet">of {leaderboard.length}</span>
            </p>
            <p className="mt-3 text-[13px] text-quiet tabular-nums">
              {me?.rank} · {me?.xp.toLocaleString()} XP
            </p>
            {/* Ranked by XP only — Doc 1 locks progression to XP, so there is
                no star or like count anywhere on this screen. */}
            <p className="mt-1 text-[12.5px] text-faint">
              {ahead ? `${(ahead.xp - (me?.xp ?? 0)).toLocaleString()} XP behind ${ahead.person.name}` : 'Top of the board'}
            </p>
          </BentoCell>

          <BentoCell icon={Users} label="Friends" onClick={() => setTab('friends')}>
            <p className="text-[28px] font-semibold leading-none tabular-nums">
              {friends.length}
            </p>
            <div className="mt-3 flex -space-x-2">
              {friends.slice(0, 5).map((f) => (
                <span
                  key={f.id}
                  title={f.name}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0d111c] bg-white/10 text-[10px] font-semibold text-quiet"
                >
                  {f.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </span>
              ))}
            </div>
          </BentoCell>

          {/* Requests is the only actionable cell here, so it is the only one
              that carries colour. */}
          <BentoCell icon={UserPlus} label="Requests" onClick={() => setTab('requests')}>
            <p
              className={cn(
                'text-[28px] font-semibold leading-none tabular-nums',
                friendRequests.length > 0 && 'text-primary',
              )}
            >
              {friendRequests.length}
            </p>
            <p className="mt-2 text-[13px] text-quiet">
              {friendRequests.length === 0 ? 'Nothing waiting' : 'Waiting on you'}
            </p>
          </BentoCell>
        </div>

        <div role="tablist" aria-label="Social" className="mt-9 flex flex-wrap items-center gap-1.5">
          {(
            [
              ['ranking', 'Ranking'],
              ['friends', `Friends · ${friends.length}`],
              ['requests', `Requests · ${friendRequests.length}`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'console-focusable h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors',
                tab === key
                  ? 'bg-white/[0.10] text-foreground'
                  : 'text-quiet hover:bg-white/[0.05] hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'ranking' && (
          <section className="mt-7">
            <p className="mb-4 text-[13.5px] text-faint">
              Ranked by XP — earned from learning, and from work of yours that other
              people found useful.
            </p>
            <ol className="space-y-1.5">
              {leaderboard.map((r, i) => (
                <li
                  key={r.person.id}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border px-5 py-3.5',
                    r.isViewer
                      ? 'border-primary/30 bg-primary/[0.07]'
                      : 'border-transparent hover:bg-white/[0.03]',
                  )}
                >
                  <span className="w-6 shrink-0 text-[14px] text-faint tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <AuthorLine person={r.person} />
                    <p className="mt-1 text-[12.5px] text-faint tabular-nums">
                      {r.rank}
                      {r.sharedSpaces > 0 && (
                        <> · {r.sharedSpaces} {r.sharedSpaces === 1 ? 'Space' : 'Spaces'} in common</>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-[14px] font-semibold text-quiet tabular-nums">
                    {r.xp.toLocaleString()} XP
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {tab === 'friends' && (
          <section className="mt-7">
            {friends.length === 0 ? (
              <Empty
                title="No friends yet"
                body="Find people in the Spaces you’re already in — you’re learning the same things."
              />
            ) : (
              <ul className="space-y-1.5">
                {friends.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-4 rounded-2xl px-5 py-3.5 hover:bg-white/[0.03]"
                  >
                    <AuthorLine person={p} />
                    <button
                      type="button"
                      className="console-focusable h-9 shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08]"
                    >
                      View profile
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="console-focusable mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-[14px] font-medium text-quiet transition-colors hover:border-white/30 hover:text-foreground"
            >
              <Search aria-hidden className="h-4 w-4" />
              Find people
            </button>
          </section>
        )}

        {tab === 'requests' && (
          <section className="mt-7">
            {friendRequests.length === 0 ? (
              <Empty title="No requests" body="Nothing waiting for you right now." />
            ) : (
              <ul className="space-y-1.5">
                {friendRequests.map((r) => (
                  <li
                    key={r.person.id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <AuthorLine person={r.person} />
                      <p className="mt-1 text-[12.5px] text-faint tabular-nums">
                        {r.sharedSpaces} Spaces in common
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Accept ${r.person.name}`}
                        className="console-focusable flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-slate-900"
                      >
                        <Check aria-hidden className="h-3.5 w-3.5" />
                        Accept
                      </button>
                      <button
                        type="button"
                        aria-label={`Decline ${r.person.name}`}
                        className="console-focusable flex h-9 w-9 items-center justify-center rounded-full border border-white/12 text-quiet transition-colors hover:bg-white/[0.08]"
                      >
                        <X aria-hidden className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Scene>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
      <UserPlus aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
      <p className="mb-1.5 text-[16px] font-semibold">{title}</p>
      <p className="mx-auto max-w-[44ch] text-[14px] leading-relaxed text-quiet">{body}</p>
    </div>
  );
}
