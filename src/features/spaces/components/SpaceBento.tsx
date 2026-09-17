import { Heart, MessageSquare, Orbit, Play, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import { BentoCell } from './BentoCell';
import { Avatar } from './Avatar';
import { viewer } from '../mocks/people';
import type { Contribution, Lesson, Membership, Space } from '../types';

/**
 * The Space at a glance — a bento of widgets.
 *
 * Modelled on the PS5 home: heterogeneous cells of different spans, each with
 * a small icon-and-label header and its own kind of content — a stat, a list,
 * a progress bar, a slice of art. The product already ships this pattern in
 * `features/student/BentoGrid` ("floating glass cell — the depth panel every
 * widget sits in"); this is the same language in the v4 namespace, since that
 * one belongs to the old product and must not be imported.
 *
 * It sits *above* the path, not instead of it. Doc 2 requires Overview to stay
 * one scroll — the path, then "From the community" beneath it — so this is a
 * summary you can act from, and the path directly below is still the thing you
 * work through.
 */

interface Props {
  space: Space;
  lessons: Lesson[];
  nextLesson?: Lesson;
  contributions: Contribution[];
  members: Membership[];
  onOpenMembers: () => void;
  onOpenMap: () => void;
  onOpenCommunity: () => void;
}

export function SpaceBento({
  space,
  lessons,
  nextLesson,
  contributions,
  members,
  onOpenMembers,
  onOpenMap,
  onOpenCommunity,
}: Props) {
  const published = lessons.filter((l) => l.state === 'published');
  const done = published.filter((l) => l.progress === 'done').length;
  const concepts = published.flatMap((l) => l.concepts);
  const cleared = concepts.filter((c) => c.progress === 'cleared').length;
  const top = contributions[0];
  const NextIcon = nextLesson ? topicIcon(nextLesson.title, nextLesson.id) : Play;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Up next — the widest cell, with art bleeding off the right edge. */}
      {nextLesson && (
        <BentoCell
          icon={Play}
          label="Continue"
          className="sm:col-span-2"
          art={
            <>
              <div
                className={cn('absolute inset-0 bg-gradient-to-l opacity-35', gradientFor(nextLesson.order))}
              />
              <NextIcon aria-hidden className="absolute right-5 top-1/2 h-16 w-16 -translate-y-1/2 text-white/10" />
            </>
          }
        >
          <p className="text-[12.5px] text-faint">Lesson {nextLesson.order}</p>
          <p className="mt-0.5 line-clamp-2 pr-24 text-[17px] font-semibold leading-snug">
            {nextLesson.title}
          </p>
          {nextLesson.percentComplete > 0 && (
            <div className="mt-3 h-1 w-full max-w-[14rem] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                style={{ width: `${nextLesson.percentComplete}%` }}
              />
            </div>
          )}
        </BentoCell>
      )}

      {/* Progress — one number, the way the console reports storage or trophies. */}
      <BentoCell icon={TrendingUp} label="Your progress">
        <p className="text-[28px] font-semibold leading-none tabular-nums">
          {space.viewerProgress}
          <span className="text-[18px] text-quiet">%</span>
        </p>
        <p className="mt-2 text-[13px] text-quiet tabular-nums">
          {done} of {published.length} Lessons
        </p>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
            style={{ width: `${space.viewerProgress}%` }}
          />
        </div>
      </BentoCell>

      {/* Members — an avatar stack, like Online Friends. */}
      <BentoCell icon={Users} label="Members" onClick={onOpenMembers}>
        <p className="text-[28px] font-semibold leading-none tabular-nums">
          {space.memberCount.toLocaleString()}
        </p>
        {/*
          Avatar, not hand-rolled initials. Three call sites drew their own,
          and the viewer — the one person who has a Luna — rendered as "Ab"
          here while rendering as Luna in the top bar two inches away.
        */}
        <div className="mt-3 flex -space-x-2">
          {members.slice(0, 5).map((m) => (
            <Avatar
              key={m.person.id}
              person={m.person}
              size="sm"
              isViewer={m.person.id === viewer.id}
              className="border-2 border-[#0d111c]"
            />
          ))}
        </div>
      </BentoCell>

      {/* The map, as a preview rather than a chart. */}
      <BentoCell icon={Orbit} label="Map" onClick={onOpenMap}>
        <p className="text-[28px] font-semibold leading-none tabular-nums">
          {cleared}
          <span className="text-[18px] text-quiet">/{concepts.length}</span>
        </p>
        <p className="mt-2 text-[13px] text-quiet">ideas cleared</p>
        {/* A slice of the real thing: one dot per Lesson, lit as earned. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {published.slice(0, 12).map((l) => (
            <span
              key={l.id}
              className={cn(
                'h-2 w-2 rounded-full',
                l.progress === 'done'
                  ? 'bg-[#ffd98a]'
                  : l.progress === 'in-progress'
                    ? 'bg-[#8d7bff]'
                    : 'bg-white/15',
              )}
            />
          ))}
        </div>
      </BentoCell>

      {/* What the community made — the top-liked item, as a taste of it. */}
      {top && (
        <BentoCell
          icon={MessageSquare}
          label={`From the community · ${contributions.length}`}
          className="sm:col-span-2"
          onClick={onOpenCommunity}
        >
          <p className="line-clamp-1 text-[15px] font-semibold">{top.title}</p>
          <div className="mt-2 flex items-center gap-2.5 text-[13px] text-quiet">
            <span>{top.author.name}</span>
            <span aria-hidden className="text-faint">·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Heart aria-hidden className="h-3.5 w-3.5" />
              {top.likeCount}
            </span>
          </div>
        </BentoCell>
      )}
    </div>
  );
}
