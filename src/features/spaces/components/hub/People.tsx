import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatNumber } from '../../i18n/format';
import type { Space } from '../../types';
import { Avatar } from '../Avatar';

/**
 * The people and the place in a Space — told, not tabulated.
 *
 * Abi, 2026-10-26: "give a life to the informations not only raw text". The
 * hero's meta line was "Öffentlich · 128 Mitglieder · 12 Lektionen". Each of
 * those is now said the way a person would say it, with the faces beside it:
 *
 *   (avatar) von Thorsten Papenbrock
 *   (avatars) Lea, Jonas und 125 andere lernen hier
 *   Du warst zuletzt auf Seite 32 · Drei-Schichten-Modell
 *
 * Faces come only from `space.faces`, which the server fills for Spaces you
 * are in. A Space you are browsing says how many people learn there, without
 * showing who.
 */

/** The hub's own `t`, as `useTranslation('v4Spaces')` hands it out. */
type HubT = ReturnType<typeof useTranslation<'v4Spaces'>>['t'];

/** Members other than the viewer — `memberCount` counts the viewer once they joined. */
const othersIn = (space: Space) => Math.max(0, space.memberCount - (space.viewerRole === 'member' ? 1 : 0));

/** "Lea, Jonas und 125 andere lernen hier", or null when nobody else is here. */
export function peopleLine(t: HubT, space: Space): string | null {
  const faces = space.faces ?? [];
  const others = othersIn(space);
  if (faces.length === 0) {
    return others > 0 && space.viewerRole === null
      ? t('hub.people.count', { count: others, n: formatNumber(others) })
      : null;
  }
  const named = faces.slice(0, 2).map((f) => f.name.split(' ')[0]);
  const rest = Math.max(0, others - named.length);
  if (rest > 0) return t('hub.people.withOthers', { names: named.join(', '), count: rest });
  return named.length === 1
    ? t('hub.people.one', { name: named[0] })
    : t('hub.people.two', { a: named[0], b: named[1] });
}

/** Up to three faces, overlapping, with a quiet "+N" for the rest. */
export function FaceStack({
  space,
  size = 'xs',
  withMore = true,
  className,
}: {
  space: Space;
  size?: 'xs' | 'sm';
  withMore?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('v4Spaces');
  const faces = (space.faces ?? []).slice(0, 3);
  if (faces.length === 0) return null;
  const rest = Math.max(0, othersIn(space) - faces.length);
  return (
    <span aria-hidden className={cn('flex items-center', className)}>
      {faces.map((f, i) => (
        <Avatar
          key={f.id}
          person={f}
          size={size}
          className={cn('ring-2 ring-black', i > 0 && '-ml-1.5')}
        />
      ))}
      {withMore && rest > 0 && (
        <span
          title={t('hub.people.more', { count: rest })}
          className={cn(
            '-ml-1.5 flex items-center justify-center rounded-full bg-white/[0.1] px-1.5 font-medium text-quiet ring-2 ring-black',
            size === 'xs' ? 'h-5 min-w-5 text-[9.5px]' : 'h-7 min-w-7 text-[10.5px]',
          )}
        >
          +{formatNumber(rest)}
        </span>
      )}
    </span>
  );
}

/** The hero's three lines: who made it, who is here, where you are. */
export function SpaceLife({ space }: { space: Space }) {
  const { t } = useTranslation('v4Spaces');
  const people = peopleLine(t, space);
  const place = space.lastPlace;
  const isPrivate = space.visibility !== 'public';
  const mine = space.viewerRole === 'owner';
  return (
    <div className="flex flex-col gap-[11px] text-[13.5px] text-quiet">
      <span className="flex items-center gap-2.5">
        <Avatar person={space.owner} size="xs" isViewer={mine} />
        <span className="truncate">
          {mine ? t('hub.people.byYou') : t('hub.people.by', { name: space.owner.name })}
          {/* Public is the default and goes unsaid; a closed door is worth a word. */}
          {isPrivate && !space.personal && <span className="text-label"> · {t('hub.cards.inviteOnlyShort')}</span>}
          {/* Someone deciding whether to join wants the size of the path; a member sees it on the ring. */}
          {space.viewerRole === null && (
            <span className="text-label"> · {t('badges.lessons', { count: space.lessonCount })}</span>
          )}
        </span>
      </span>

      {people && (
        <span className="flex items-center gap-2.5">
          <FaceStack space={space} withMore={false} />
          <span className="truncate">{people}</span>
        </span>
      )}

      {place ? (
        <Link
          to={`/v4/space/${space.id}/lesson/${place.lessonId}`}
          className="console-focusable -mx-1 w-fit max-w-full truncate rounded px-1 text-foreground underline-offset-4 hover:underline"
        >
          {t('hub.place.last', { page: formatNumber(place.page), title: place.lessonTitle })}
        </Link>
      ) : (
        space.newSinceLastVisit > 0 && (
          <span className="flex items-center gap-2.5 text-foreground">
            <i aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#57d98a]" />
            {t('hub.chips.newLessons', { count: space.newSinceLastVisit })}
          </span>
        )
      )}
    </div>
  );
}
