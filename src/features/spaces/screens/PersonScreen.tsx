import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Heart } from 'lucide-react';
import { people, viewer } from '../mocks/people';
import { leaderboard } from '../mocks/library';
import { normalizationContributions, spaceContributions } from '../mocks/contributions';
import { conceptContributions } from '../mocks/concepts';
import { allSpaces } from '../mocks/spaces';
import { locateLesson } from '../mocks/lessons';
import { isFriend } from '../mocks/social';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { Avatar } from '../components/Avatar';
import { EndorsedBadge } from '../components/badges';
import { NotFound } from '../components/states';

/**
 * Someone else's public profile.
 *
 * Doc 2 lists these among Social's destinations — "friends, requests, finding
 * people, their public profiles, and rankings" — and there was no screen, so
 * every "View profile" button on Social was inert.
 *
 * Two rules shape what is on it:
 *   • **Social shows people, not Space cards.** Shared Spaces are named as
 *     context and link to the Space; they are not rendered as tiles, or this
 *     becomes a second Spaces screen.
 *   • **Public means published.** Their notes are theirs, their drafts are
 *     theirs. What appears here is what they chose to publish, which is the
 *     same set anyone in those Spaces can already see.
 */

export default function PersonScreen() {
  const { personId } = useParams<{ personId: string }>();
  const person = people.find((p) => p.id === personId);

  const standing = leaderboard.find((r) => r.person.id === personId);

  /** Everything they published, at any anchor level. */
  const published = useMemo(
    () =>
      [...normalizationContributions, ...spaceContributions, ...conceptContributions]
        .filter((c) => c.author.id === personId && !c.hidden)
        .sort((a, b) => b.likeCount - a.likeCount),
    [personId],
  );

  /** Spaces you are both in — the reason they are on your Social screen. */
  const shared = useMemo(
    () => allSpaces.filter((s) => s.viewerRole !== null && s.owner.id !== viewer.id),
    [],
  );

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.social} status="progress" motionKey={`person-${personId}`}>
      <SpacesTopBar active="social" viewer={viewer} />
      {body}
    </Scene>
  );

  if (!person) {
    return chrome(<NotFound what="person" backTo="/v4/social" backLabel="Back to Social" />);
  }

  return chrome(
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-6 lg:px-8">
      <Link
        to="/v4/social"
        className="console-focusable mb-8 -ml-2 inline-flex h-9 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.05] hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Social
      </Link>

      <header className="flex flex-wrap items-center gap-5">
        <Avatar person={person} size="lg" className="h-16 w-16" />
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">{person.name}</h1>
          <p className="mt-1 text-[14px] text-quiet tabular-nums">
            {standing ? `${standing.rank} · ${standing.xp.toLocaleString()} XP` : 'No rank yet'}
            {isFriend(person.id) && <span className="text-faint"> · Friends</span>}
          </p>
        </div>
      </header>

      {/* Named, not tiled — Social shows people, never Space cards. */}
      {shared.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-3 text-[14px] font-medium text-quiet">Spaces you are both in</h2>
          <ul className="flex flex-wrap gap-2">
            {shared.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/v4/space/${s.id}`}
                  className="console-focusable inline-flex h-9 items-center rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-9">
        <h2 className="mb-3 text-[14px] font-medium text-quiet">
          What they have published
          {published.length > 0 && (
            <span className="ml-2 text-faint tabular-nums">{published.length}</span>
          )}
        </h2>

        {published.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/12 px-5 py-9 text-center text-[14px] text-quiet">
            {person.name} hasn’t published anything in a Space you share.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {published.map((c) => {
              const at =
                c.anchor.level === 'lesson' ? locateLesson(c.anchor.lessonId) : undefined;
              const href =
                c.anchor.level === 'space'
                  ? `/v4/space/${c.anchor.spaceId}`
                  : at
                    ? `/v4/space/${at.spaceId}/lesson/${at.lesson.id}`
                    : null;
              const row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{c.title}</span>
                    {at && (
                      <span className="mt-0.5 block truncate text-[12.5px] text-quiet">
                        {at.lesson.title}
                      </span>
                    )}
                  </span>
                  {c.endorsed && <EndorsedBadge />}
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-quiet tabular-nums">
                    <Heart aria-hidden className="h-3.5 w-3.5" />
                    {c.likeCount}
                  </span>
                </>
              );
              const cls =
                'flex w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 text-left transition-colors';
              return (
                <li key={c.id}>
                  {href ? (
                    <Link to={href} className={`console-focusable ${cls} hover:bg-white/[0.05]`}>
                      {row}
                    </Link>
                  ) : (
                    // No anchor left to open. Shown, because their work does
                    // not vanish, but not made to look like a link.
                    <div className={cls}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>,
  );
}
