import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Search, UserPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { leaderboard } from '../mocks/library';

/** Your row on the board — what the "Where you stand" cell opens. */
const STANDING_ROW_ID = 'your-standing';
import {
  acceptRequest,
  currentFriends,
  currentRequests,
  declineRequest,
} from '../mocks/social';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';
import { AuthorLine } from '../components/badges';
import { Avatar } from '../components/Avatar';
import { Masthead, Sep, Skylight, ghostPillSm, stageCard, whitePillSm } from '../components/stage';

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
  const screenState = useScreenState();
  /*
   * Accepting or declining mutates a store outside React, so a tick re-reads
   * it. Before this, both buttons were enabled, named the person in their
   * aria-label, and did nothing — a request you accepted stayed in the list,
   * which reads as the action having failed.
   */
  const [socialTick, setSocialTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const friends = useMemo(() => currentFriends(), [socialTick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const friendRequests = useMemo(() => currentRequests(), [socialTick]);
  const [tab, setTab] = useState<Tab>('ranking');

  const myPosition = leaderboard.findIndex((r) => r.isViewer) + 1;

  /*
   * No state and no effect here, unlike Library's equivalent: the board is
   * rendered unconditionally on this screen, so the row already exists when
   * the click happens. Library had to change a filter first, which is why that
   * one needed an effect to wait for the commit.
   */
  const showMyStanding = () => {
    const row = document.getElementById(STANDING_ROW_ID);
    row?.scrollIntoView({ block: 'center' });
    row?.focus();
  };
  const me = leaderboard.find((r) => r.isViewer);
  /** The person immediately above you — the only gap worth reporting. */
  const ahead = leaderboard[myPosition - 2];
  /** You, and whoever is either side of you on the board. */
  const neighbours = leaderboard.slice(Math.max(0, myPosition - 2), myPosition + 1);

  // Social stands on the stage. People are not a subject, so the light is
  // the brand's — neutral white — never a colour (monochrome brand).
  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.social} status="progress" motionKey="social" accent={null}>
      <SpacesTopBar active="social" viewer={viewer} />
      <div className="relative">
        <Skylight accent={null} />
        {body}
      </div>
    </Scene>
  );

  // All four states. `?mock=loading|error` was a no-op on this screen.
  if (screenState === 'loading') return chrome(<ListSkeleton label="Loading social" />);
  if (screenState === 'error') return chrome(<SpacesError what="your people" />);

  return chrome(
    <>

      <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
        <header>
          <Masthead title="Social" lede="The people you’re learning alongside." />
        </header>

        {/*
          ── Where you stand, drawn ──
          Was an eyebrow ("6 friends · #1 on the board") over three bento
          cells that repeated it and then opened the tabs beneath them — one
          fact, three times (Abi, 2026-10-10). Now the standing is a race line:
          you and your neighbours on the board, placed by XP, and one sentence
          for the gap. The counts live on the tabs, once.
        */}
        <button
          type="button"
          onClick={showMyStanding}
          aria-label={
            ahead
              ? `Number ${myPosition} on the board, ${(ahead.xp - (me?.xp ?? 0)).toLocaleString()} XP behind ${ahead.person.name}. Show the board.`
              : `Top of the board. Show the board.`
          }
          className="console-focusable group mx-auto mt-14 block w-full max-w-2xl rounded-3xl px-6 py-8 text-left transition-colors hover:bg-white/[0.03]"
        >
          <RaceLine around={neighbours} />
          <p className="mt-6 text-center text-[15px] text-quiet">
            <span className="font-medium text-foreground">#{myPosition}</span>
            <Sep />
            {ahead
              ? `${(ahead.xp - (me?.xp ?? 0)).toLocaleString()} XP behind ${ahead.person.name}`
              : 'Nobody ahead of you'}
          </p>
        </button>

        <div role="tablist" aria-label="Social" className="mt-16 flex flex-wrap items-center justify-center gap-1.5">
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
          <section className="mt-8">
            <p className="mb-4 text-[13.5px] text-faint">
              Ranked by XP — earned from learning, and from work of yours that other
              people found useful.
            </p>
            <ol className="space-y-1.5">
              {leaderboard.map((r, i) => (
                <li
                  key={r.person.id}
                  /*
                   * Your own row is the target of the "Where you stand" cell
                   * above. `tabIndex={-1}` because a `li` cannot take focus
                   * otherwise — it makes the row focusable *programmatically*
                   * without inserting it into the tab order, so keyboard users
                   * are not made to tab through the board to reach it.
                   */
                  id={r.isViewer ? STANDING_ROW_ID : undefined}
                  tabIndex={r.isViewer ? -1 : undefined}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border px-5 py-3.5',
                    r.isViewer
                      ? 'border-white/[0.16] bg-white/[0.06]'
                      : 'border-transparent hover:bg-white/[0.03]',
                  )}
                >
                  <span className="w-6 shrink-0 text-[14px] text-faint tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <AuthorLine person={r.person} />
                    {/* Position and XP already rank the row; the tier word
                        on every line was the same word ten times. */}
                    {r.sharedSpaces > 0 && (
                      <p className="mt-1 text-[12.5px] text-faint tabular-nums">
                        {r.sharedSpaces} {r.sharedSpaces === 1 ? 'Space' : 'Spaces'} in common
                      </p>
                    )}
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
          <section className="mt-8">
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
                    <Link
                      to={`/v4/person/${p.id}`}
                      aria-label={`View ${p.name}'s profile`}
                      className={cn(ghostPillSm, 'shrink-0')}
                    >
                      View profile
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {/* One search, not two. Finding people goes through the same ⌘K
                palette as everything else rather than growing a second search
                box that knows about a different half of the data. */}
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
                )
              }
              className="console-focusable mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-[14px] font-medium text-quiet transition-colors hover:border-white/30 hover:text-foreground"
            >
              <Search aria-hidden className="h-4 w-4" />
              Find people
            </button>
          </section>
        )}

        {tab === 'requests' && (
          <section className="mt-8">
            {friendRequests.length === 0 ? (
              <Empty title="No requests" body="Nothing waiting for you right now." />
            ) : (
              <ul className="space-y-1.5">
                {friendRequests.map((r) => (
                  <li
                    key={r.person.id}
                    className={cn(stageCard, 'flex items-center justify-between gap-4 px-5 py-3.5')}
                  >
                    <div className="min-w-0">
                      <AuthorLine person={r.person} />
                      <p className="mt-1 text-[12.5px] text-faint tabular-nums">
                        {r.sharedSpaces} {r.sharedSpaces === 1 ? 'Space' : 'Spaces'} in common
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          acceptRequest(r.person.id);
                          setSocialTick((n) => n + 1);
                          toast(`${r.person.name} is now a friend`);
                        }}
                        aria-label={`Accept ${r.person.name}`}
                        className={whitePillSm}
                      >
                        <Check aria-hidden className="h-3.5 w-3.5" />
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          declineRequest(r.person.id);
                          setSocialTick((n) => n + 1);
                          // Declining is quiet on purpose: they are not told.
                          toast('Request declined');
                        }}
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
    </>,
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

/**
 * The board, as a place: you and your neighbours on one track, spaced by XP.
 * Distance is the gap — nobody has to read a number to see it.
 */
function RaceLine({ around }: { around: typeof leaderboard }) {
  const xs = around.map((r) => r.xp);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const at = (xp: number) => (hi === lo ? 50 : 8 + ((xp - lo) / (hi - lo)) * 84);
  return (
    <div aria-hidden className="relative h-20">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.12]" />
      {around.map((r) => (
        <div
          key={r.person.id}
          className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `${at(r.xp)}%` }}
        >
          <Avatar
            person={r.person}
            size={r.isViewer ? 'lg' : 'md'}
            isViewer={r.isViewer}
            className={cn(r.isViewer ? 'ring-2 ring-white' : 'opacity-70')}
          />
          <span className={cn('mt-2 whitespace-nowrap text-[12px] tabular-nums', r.isViewer ? 'text-foreground' : 'text-faint')}>
            {r.isViewer ? 'You' : r.person.name.split(' ')[0]}
          </span>
        </div>
      ))}
    </div>
  );
}
