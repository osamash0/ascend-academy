import { ArrowLeft, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import { viewer } from '../mocks/people';
import { moments } from '../mocks/moments';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { EnterGroup, EnterItem, EnterList, EnterListItem } from '../components/Enter';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';

/**
 * Moments — the first time each thing happened.
 *
 * ## What this replaced, and why
 *
 * A badge wall: six achievements, three earned, `3/6` at the top and the
 * unearned ones drawn in dashed outlines with a padlock. Abi's call was to
 * drop it, and the docs agree on three separate counts.
 *
 * **The word was taken.** Every "badge" in `docs/design-v4` is a label on
 * *content* — origin, mode, visibility, "new". `components/badges.tsx` exports
 * exactly that sense, one directory from a fixture that meant achievements.
 * Doc 1 rule 7 is "One word, one meaning (locked)", and the docs' own notes
 * say "badge must mean exactly one thing. Otherwise remove."
 *
 * **`3/6` was a second progression** on the Ascent profile, which rule 4
 * forbids in as many words. **And two of the six contradicted Engagement
 * rules by name**: one hung a reward off a like count, the other rewarded
 * publishing — "reward reception, not production, or you get spam within a
 * week".
 *
 * ## What makes this version safe
 *
 * A moment is a fact with a date. It grants nothing, cannot be lost, has no
 * total, and nothing is dangled unearned — so there is nothing to complete and
 * no second currency. That is the same reasoning that let study history exist.
 *
 * The absence of a locked row is the whole design. A padlocked "Get 25 likes
 * on your work" is an instruction to go and farm likes; an empty space is not.
 *
 * Learn mode: a record of you, calm and browsable.
 */

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function MomentsScreen() {
  const screenState = useScreenState();
  const all = moments();

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.profile} status="progress" motionKey="moments">
      <SpacesTopBar active="profile" viewer={viewer} />
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<ListSkeleton label="Loading your moments" />);
  if (screenState === 'error') return chrome(<SpacesError what="your moments" />);

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
              <Award aria-hidden className="h-4 w-4" />
              Moments
            </p>
            <h1 className="mt-3 text-5xl font-bold tracking-[-0.02em]">
              The firsts
            </h1>
            {/*
              No count. `3/6` was the second progression — a total implies the
              rest are owed, and a thing you can be behind on is a currency.
            */}
            <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-quiet">
              The first time each thing happened to you here. Nothing on this page is a
              score, and there is nothing to collect — these are just the days something
              changed.
            </p>
          </header>
        </EnterItem>
      </EnterGroup>

      {all.length === 0 ? (
        <p className="mt-10 text-[14px] text-quiet">
          Nothing yet. Finish a Lesson and the first one lands here.
        </p>
      ) : (
        <EnterList whenVisible className="mt-9 space-y-2.5">
          {all.map((m) => (
            <EnterListItem
              key={m.id}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[15px] font-semibold">{m.title}</h2>
                {/*
                  A Space carries no creation date, so this one has no day. Left
                  off rather than guessed — the orphan row's invented Space is
                  the reason that rule exists here.
                */}
                {m.at && (
                  <span className="text-[12.5px] text-faint tabular-nums">
                    {formatWhen(m.at)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-quiet">{m.detail}</p>
            </EnterListItem>
          ))}
        </EnterList>
      )}
    </div>,
  );
}
