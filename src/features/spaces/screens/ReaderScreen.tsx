import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListChecks, X } from 'lucide-react';
import { spaceById } from '../mocks/spaces';
import { adjacentLessons, visibleLesson } from '../mocks/lessons';
import { Scene, SURFACES } from '../components/Scene';
import { LessonPager } from '../components/LessonPager';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { useScreenState } from '../data/useSpaces';
import { PressableLink } from '../components/Pressable';

/**
 * Reading a Lesson.
 *
 * The surface the whole design has been pointing at, and the last one built.
 * Everything else in v4 is a way of choosing what to read; this is the reading.
 *
 * A **focus** surface, by the same rule as Practice: the console texture comes
 * off, the top bar goes with it, and what is left is a column of text and a
 * way out. `Scene` enforces that by construction — the surface is a type, not
 * a convention.
 *
 * Three decisions worth naming:
 *
 *   • **A passage per Concept.** The reader walks the same objects the map
 *     lights, rather than being a parallel structure that happens to sit in
 *     the same Lesson. One idea, one heading, one place it is explained.
 *   • **Measured, not assumed.** The target is 60–70 characters a line, and
 *     the class does not say what it is: `ch` is the width of "0", so `58ch`
 *     renders 73 characters. Worse, the first tightening changed nothing —
 *     the article's `max-w-2xl` was binding and the `ch` cap never applied.
 *     It is `52ch` ≈ 66, checked in a browser. A reader is the one screen
 *     where getting the measure wrong is unmissable.
 *   • **It changes no progress.** Marking a Concept read on scroll would be
 *     inventing a progression rule, and Doc 1 locks progression to XP awarded
 *     by the engine. What reading does to the map is an open question, and an
 *     open question is not something a screen should quietly answer.
 */

export default function ReaderScreen() {
  const screenState = useScreenState();
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const space = spaceId ? spaceById(spaceId) : undefined;
  const lesson = useMemo(
    () => (space && lessonId ? visibleLesson(space, lessonId) : undefined),
    [space, lessonId],
  );

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.lessonReader} motionKey={`read-${lessonId}`}>
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<DetailSkeleton />);
  if (screenState === 'error') return chrome(<SpacesError what="this Lesson" />);

  if (!space || !lesson)
    return chrome(
      <NotFound
        what="Lesson"
        backTo={space ? `/v4/space/${space.id}` : '/v4/spaces'}
        backLabel={space ? `Back to ${space.name}` : 'Back to Spaces'}
      />,
    );

  const back = `/v4/space/${space.id}/lesson/${lesson.id}`;
  const { prev, next } = adjacentLessons(space.id, lesson.id);
  const passages = lesson.passages ?? [];

  /*
   * Written Lessons are the exception, not the rule, and the screen says which
   * one this is rather than rendering an empty column. Writing a Lesson is
   * content work; pretending otherwise would make the reader look finished
   * while testing nothing.
   */
  if (passages.length === 0) {
    return chrome(
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-2 text-[17px] font-semibold">Not written yet</p>
        <p className="mb-7 max-w-[46ch] text-[14.5px] leading-relaxed text-quiet">
          {lesson.title} has its ideas and its practice, but the text itself has not been
          built from the material yet.
        </p>
        <Link
          to={back}
          className="console-focusable inline-flex h-11 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
        >
          Back to the Lesson
        </Link>
      </div>,
    );
  }

  return chrome(
    <article className="mx-auto max-w-2xl px-6 pb-32 pt-6">
      {/* Minimal chrome: where you are, and a way out. */}
      <div className="mb-12 flex items-center gap-4">
        <Link
          to={back}
          aria-label="Leave the reader"
          className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[13px] text-quiet">
          {space.name} · Lesson {lesson.order}
        </p>
      </div>

      <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.02em]">{lesson.title}</h1>

      {passages.map((p) => (
        <section key={p.conceptId} className="mt-12">
          <h2 className="mb-4 text-[20px] font-semibold tracking-[-0.01em]">{p.heading}</h2>
          {p.body.map((para, i) => (
            <p
              key={i}
              /*
                52ch ≈ 66 characters a line, measured rather than assumed.
                Two things had to be measured to land here. `ch` is the width
                of "0", which is wider than average lowercase, so the number in
                the class is not the number of characters — 58ch renders 73.
                And the first attempt to tighten it changed nothing at all,
                because the article's own `max-w-2xl` was the binding
                constraint and the `ch` cap never applied.
              */
              className="mb-5 max-w-[52ch] text-[17px] leading-[1.75] text-foreground last:mb-0"
            >
              {para}
            </p>
          ))}
        </section>
      ))}

      {/* What to do when the reading is done. Practice is the obvious next
          move, and it is a Lesson away, not a screen away. */}
      {lesson.practiceCount > 0 && (
        <div className="mt-14 border-t border-white/[0.08] pt-8">
          <PressableLink
            to={`/v4/space/${space.id}/lesson/${lesson.id}/practice`}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14.5px] font-semibold text-slate-900"
          >
            <ListChecks aria-hidden className="h-4 w-4" />
            Practise what you just read
          </PressableLink>
        </div>
      )}

      {/* The pager walks published Lessons only — Rule 1 holds here too. */}
      <div className="mt-12">
        <LessonPager spaceId={space.id} prev={prev} next={next} />
      </div>
    </article>,
  );
}
