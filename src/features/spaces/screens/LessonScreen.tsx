import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  FileWarning,
  ListChecks,
  NotebookPen,
  Play,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LaunchButton, gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import type { Concept, Lesson, Space } from '../types';
import { spaceById } from '../mocks/spaces';
import { adjacentLessons, visibleLesson } from '../mocks/lessons';
import { contributionsForLesson } from '../mocks/contributions';
import { addNote, deleteNote, notesForLesson, updateNote } from '../mocks/notes';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { ContributionCard } from '../components/ContributionCard';
import { NoteEditor } from '../components/NoteEditor';
import { LessonPager } from '../components/LessonPager';
import { AuthorLine, GroundingMarker, OriginBadge } from '../components/badges';
import { NotFound } from '../components/states';

/**
 * A Lesson's own overview.
 *
 * The console pattern the product already uses, applied one level down: a
 * full-bleed key-art hero with a single launch action, then rows of everything
 * that belongs to this Lesson beneath it.
 *
 * This is a **browse** surface, not the reader. You are choosing what to do
 * with this Lesson — start it, practise it, read what members added. The reader
 * itself is a focus surface and stays plain; that split is the Scene rule.
 *
 * Everything Doc 1 attaches to a Lesson shows here and nowhere else has to
 * carry it: its Concepts, its practice set, the community section for this
 * anchor level, and your own private notes.
 */

const CONCEPT_STATE: Record<Concept['progress'], { label: string; cls: string }> = {
  cleared: { label: 'Cleared', cls: 'border-success/40 bg-success/10 text-success' },
  discovered: { label: 'Read', cls: 'border-white/15 bg-white/[0.05] text-quiet' },
  untouched: { label: 'Not yet', cls: 'border-white/10 bg-transparent text-faint' },
};

function Row({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-[15px] font-semibold">
        {title}
        {count !== undefined && <span className="ml-2 text-quiet tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export default function LessonScreen() {
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const navigate = useNavigate();
  const space: Space | undefined = spaceId ? spaceById(spaceId) : undefined;
  // Rule 1 runs through `visibleLesson`, not a raw lookup: a Member asking for
  // a draft by URL must get "not found", not the draft.
  const lesson: Lesson | undefined = useMemo(
    () => (space && lessonId ? visibleLesson(space, lessonId) : undefined),
    [space, lessonId],
  );

  const contributions = useMemo(
    () => (lesson ? contributionsForLesson(lesson.id).filter((c) => !c.hidden) : []),
    [lesson],
  );
  // Local tick so writes re-render; the store is the source of truth.
  const [noteTick, setNoteTick] = useState(0);
  const myNotes = useMemo(
    () => (lessonId ? notesForLesson(lessonId) : []),
    [lessonId, noteTick],
  );
  /** Published neighbours only — the pager never steps into a draft. */
  const { prev, next } = useMemo(
    () => (spaceId && lessonId ? adjacentLessons(spaceId, lessonId) : { prev: null, next: null }),
    [spaceId, lessonId],
  );

  const chrome = (body: React.ReactNode, gradientIndex = 0) => (
    <Scene
      surface={SURFACES.spaceOverview}
      status="progress"
      gradientIndex={gradientIndex}
      motionKey={lessonId}
    >
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  // Not found, not a failure — a bad id must not claim the connection dropped.
  if (!space || !lesson)
    return chrome(
      <NotFound
        what="Lesson"
        backTo={space ? `/v4/space/${space.id}` : '/v4/spaces'}
        backLabel={space ? `Back to ${space.name}` : 'Back to Spaces'}
      />,
    );

  const Icon = topicIcon(lesson.title, lesson.id);
  const cleared = lesson.concepts.filter((c) => c.progress === 'cleared').length;
  const done = lesson.progress === 'done';
  // Resume where you stopped: the first idea not yet cleared, else the first.
  const firstConcept =
    lesson.concepts.find((c) => c.progress !== 'cleared') ?? lesson.concepts[0];

  return chrome(
    <div className="pb-36">
      {/* ── Key art hero ── */}
      <div className="relative">
        <div
          aria-hidden
          className={cn(
            'absolute left-1/2 top-0 h-[340px] w-screen -translate-x-1/2 bg-gradient-to-br opacity-45',
            gradientFor(lesson.order),
          )}
        />
        {/* Legibility scrim: the hero text sits bottom-left, so darken there. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-[340px] w-screen -translate-x-1/2 bg-gradient-to-t from-[#070b14] via-[#070b14]/55 to-transparent"
        />
        <Icon
          aria-hidden
          className="pointer-events-none absolute right-10 top-14 hidden h-40 w-40 text-white/[0.06] lg:block"
        />

        <div className="relative mx-auto max-w-4xl px-6 pt-6 lg:px-8">
          <Link
            to={`/v4/space/${space.id}`}
            className="console-focusable -ml-2 mb-8 inline-flex h-9 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {space.name}
          </Link>

          <p className="text-[13px] text-quiet">
            {space.name} · Lesson {lesson.order}
          </p>
          <h1 className="mt-2 max-w-[20ch] text-4xl font-bold leading-[1.1] tracking-[-0.02em] sm:text-[46px]">
            {lesson.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {space.mode === 'open' && <OriginBadge origin={lesson.origin} />}
            <GroundingMarker
              grounding={lesson.grounding}
              spaceGroundingEnabled={space.groundingEnabled}
            />
            {done && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-[3px] text-[11.5px] font-medium text-success">
                <Check aria-hidden className="h-3 w-3" />
                Completed
              </span>
            )}
          </div>

          <div className="mt-4">
            <AuthorLine person={lesson.author} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-quiet tabular-nums">
            <span>
              {cleared}/{lesson.concepts.length} ideas
            </span>
            <span aria-hidden className="text-faint">·</span>
            <span>{lesson.practiceCount} practice questions</span>
            {lesson.contributionCount > 0 && (
              <>
                <span aria-hidden className="text-faint">·</span>
                <span>{lesson.contributionCount} contributions</span>
              </>
            )}
          </div>

          {lesson.percentComplete > 0 && lesson.percentComplete < 100 && (
            <div className="mt-4 flex max-w-sm items-center gap-3">
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                  style={{ width: `${lesson.percentComplete}%` }}
                />
              </div>
              <span className="shrink-0 text-[13px] text-quiet tabular-nums">
                {lesson.percentComplete}%
              </span>
            </div>
          )}

          {/* One primary action. Everything else is subordinate. */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {/*
              Starting a Lesson means reading its first idea. There is no
              separate reader screen in this build and the fixtures carry no
              prose, so rather than launch into an empty shell the primary
              action goes to the first Concept — a screen that exists and has
              something in it. NEEDS-CONTENT: the real reader replaces this.
            */}
            <LaunchButton
              label={done ? 'Review' : lesson.percentComplete > 0 ? 'Continue' : 'Start'}
              icon={Play}
              onClick={() =>
                firstConcept
                  ? navigate(`/v4/space/${space.id}/concept/${firstConcept.id}`)
                  : navigate(`/v4/space/${space.id}/lesson/${lesson.id}/practice`)
              }
            />
            {lesson.practiceCount > 0 && (
              <Link
                to={`/v4/space/${space.id}/lesson/${lesson.id}/practice`}
                className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-6 text-[14px] font-medium transition-colors hover:bg-white/[0.09]"
              >
                <ListChecks aria-hidden className="h-4 w-4" />
                Practice
              </Link>
            )}
          </div>

          {/* Deleting a Material never breaks its Lesson. */}
          {lesson.material === null && (
            <p className="mt-5 inline-flex items-center gap-2 text-[13px] text-quiet">
              <FileWarning aria-hidden className="h-3.5 w-3.5" />
              The original file was removed. This Lesson still works.
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        {/* ── Concepts ── */}
        {lesson.concepts.length > 0 && (
          <Row title="Ideas in this Lesson" count={lesson.concepts.length}>
            <ul className="flex flex-wrap gap-2">
              {lesson.concepts.map((c) => {
                const st = CONCEPT_STATE[c.progress];
                return (
                  <li key={c.id}>
                    {/* Each idea has its own overview — where it also appears,
                        its practice, and the community section at Concept
                        anchor level. */}
                    <Link
                      to={`/v4/space/${space.id}/concept/${c.id}`}
                      aria-label={`${c.name} — ${st.label}`}
                      className={cn(
                        'console-focusable inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] transition-colors hover:border-white/30',
                        st.cls,
                      )}
                    >
                      {c.progress === 'cleared' && <Check aria-hidden className="h-3 w-3" />}
                      {c.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[13px] text-faint">
              Each idea lights up on the Space’s map as you clear it.
            </p>
          </Row>
        )}

        {/* ── Community, at the Lesson anchor level ── */}
        <Row title="From the community" count={contributions.length}>
          {contributions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
              <Sparkles aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
              <p className="mb-1.5 text-[15px] font-semibold">Nothing here yet</p>
              <p className="mx-auto max-w-[44ch] text-[14px] leading-relaxed text-quiet">
                If something in this Lesson finally clicked for you, that explanation will
                help the next person.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {contributions.map((c, i) => (
                <ContributionCard
                  key={c.id}
                  contribution={c}
                  space={space}
                  isOwn={c.author.id === viewer.id}
                  featured={i === 0 && contributions.length > 1}
                  className={i === 0 && contributions.length > 1 ? 'sm:col-span-2' : undefined}
                />
              ))}
            </div>
          )}
        </Row>

        {/* ── Your notes: private, and the one thing only you can see ── */}
        <Row title="Your notes" count={myNotes.length}>
          <div className="space-y-2.5">
            {myNotes.map((n) => (
              <NoteEditor
                key={n.id}
                value={n.body}
                onSave={(body) => {
                  updateNote(n.id, body);
                  setNoteTick((t) => t + 1);
                }}
                onDelete={() => {
                  deleteNote(n.id);
                  setNoteTick((t) => t + 1);
                }}
              />
            ))}

            {/* Doc 2 Create rule: "New Note — the reader, and in Library." */}
            <NoteEditor
              key={`new-${noteTick}`}
              placeholder="Private to you, and gathered in your Library."
              onSave={(body) => {
                addNote({
                  lessonId: lesson.id,
                  body,
                  lessonTitle: lesson.title,
                  spaceId: space.id,
                  spaceName: space.name,
                });
                setNoteTick((t) => t + 1);
              }}
            />

            {myNotes.length === 0 && (
              <p className="px-1 text-[13px] text-faint">
                Nothing yet. Notes are private, and only you ever see them.
              </p>
            )}
          </div>
        </Row>
      </div>

      {spaceId && <LessonPager spaceId={spaceId} prev={prev} next={next} />}
    </div>,
    lesson.order,
  );
}
