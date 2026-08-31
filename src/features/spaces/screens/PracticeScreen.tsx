import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pressable } from '../components/Pressable';
import { spaceById } from '../mocks/spaces';
import { visibleLesson } from '../mocks/lessons';
import { gradeAnswer, practiceForLesson } from '../mocks/practice';
import { Scene, SURFACES } from '../components/Scene';
import { useScreenState } from '../data/useSpaces';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';

/**
 * Practice for one Lesson.
 *
 * A **focus** surface — the first screen in v4 that is neither browsing nor
 * managing. You are working, so the console texture comes off and the top bar
 * goes with it: one question, four choices, nothing else competing.
 *
 * Two things it refuses to do:
 *   • **Move on before explaining.** Every answer, right or wrong, shows why.
 *     Practice that only says "wrong" teaches nothing, and a guard enforces
 *     that every question carries an explanation.
 *   • **Score you.** There is a tally at the end because you asked for
 *     practice, but it grants no XP here and feeds no ranking — Doc 1 keeps
 *     progression on XP alone, awarded by the engine, not by a quiz screen.
 */

export default function PracticeScreen() {
  const screenState = useScreenState();
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const navigate = useNavigate();
  const space = spaceId ? spaceById(spaceId) : undefined;
  const lesson = useMemo(
    () => (space && lessonId ? visibleLesson(space, lessonId) : undefined),
    [space, lessonId],
  );
  const questions = useMemo(() => (lessonId ? practiceForLesson(lessonId) : []), [lessonId]);

  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const [done, setDone] = useState(false);

  /*
   * Answer state belongs to one Lesson, and React does not know that.
   *
   * `Scene` guarantees no remount ("one tree, always"), and both practice URLs
   * resolve to the same element at the same router position — so moving from
   * one Lesson's practice to another reused the mount and kept the old
   * `index`, `right` and `done`. You landed on a tally reading "3/1" without
   * ever seeing question one, and with `index` past the end of a shorter set,
   * `questions[index]` was `undefined` and reading `.prompt` threw.
   *
   * Resetting in an effect rather than with a `key` on the route, because the
   * no-remount guarantee is load-bearing elsewhere and worth keeping.
   */
  useEffect(() => {
    setIndex(0);
    setPicked(null);
    setRight(0);
    setDone(false);
  }, [lessonId]);

  const explanationRef = useRef<HTMLDivElement>(null);
  // Answering replaces what matters on screen; move focus to it.
  useEffect(() => {
    if (picked) explanationRef.current?.focus();
  }, [picked]);

  /*
   * Escape leaves. This is a full-bleed surface with the chrome stripped and
   * one X to exit — Escape is what a hand reaches for, and it cost nothing to
   * honour.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && space && lesson) {
        navigate(`/v4/space/${space.id}/lesson/${lesson.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, space, lesson]);

  const chrome = (body: React.ReactNode) => (
    // Focus: plain near-black, no parallax, nothing to look at but the question.
    <Scene surface={SURFACES.practice} motionKey={`practice-${lessonId}`}>
      {body}
    </Scene>
  );

  // All four states, on every screen. `?mock=loading|error` used to be a
  // no-op here, so these two had never been seen.
  if (screenState === 'loading') return chrome(<DetailSkeleton />);
  if (screenState === 'error') return chrome(<SpacesError what="this practice" />);

  if (!space || !lesson)
    return chrome(
      <NotFound
        what="Lesson"
        backTo={space ? `/v4/space/${space.id}` : '/v4/spaces'}
        backLabel={space ? `Back to ${space.name}` : 'Back to Spaces'}
      />,
    );

  const backToLesson = `/v4/space/${space.id}/lesson/${lesson.id}`;

  if (questions.length === 0) {
    return chrome(
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-2 text-[17px] font-semibold">No practice here yet</p>
        <p className="mb-7 text-[14.5px] leading-relaxed text-quiet">
          Nothing has been written for {lesson.title} so far.
        </p>
        <Link
          to={backToLesson}
          className="console-focusable inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back to the Lesson
        </Link>
      </div>,
    );
  }

  const q = questions[index];
  const graded = picked ? gradeAnswer(q, picked) : null;
  const isLast = index === questions.length - 1;

  if (done) {
    return chrome(
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <p className="text-[13px] text-quiet">{lesson.title}</p>
        <p className="mt-3 text-[44px] font-bold leading-none tabular-nums">
          {right}
          <span className="text-[24px] text-quiet">/{questions.length}</span>
        </p>
        <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-quiet">
          {right === questions.length
            ? 'Every one. The ideas behind these are cleared on the map.'
            : 'What you missed is worth a second read — the explanations are the point, not the score.'}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setPicked(null);
              setRight(0);
              setDone(false);
            }}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-slate-900"
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            Again
          </button>
          <button
            type="button"
            onClick={() => navigate(backToLesson)}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
          >
            Back to the Lesson
          </button>
        </div>
      </div>,
    );
  }

  return chrome(
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Minimal chrome: where you are, and a way out. */}
      <div className="mb-10 flex items-center gap-4">
        <Link
          to={backToLesson}
          aria-label="Leave practice"
          className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-quiet">{lesson.title}</p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-[width] duration-300"
              style={{ width: `${((index + (picked ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-[13px] text-faint tabular-nums">
          {index + 1}/{questions.length}
        </span>
      </div>

      <h1 className="text-[26px] font-semibold leading-snug">{q.prompt}</h1>

      <ul className="mt-8 space-y-2.5">
        {q.choices.map((c) => {
          const chosen = picked === c;
          const isAnswer = c === q.correctAnswer;
          // Once answered, the right one is always shown — including when you
          // got it right, so the screen never hides what it was testing.
          const reveal = picked !== null;
          return (
            <li key={c}>
              {/*
                `aria-disabled`, not `disabled`. A real `disabled` removed the
                button from the tab order the instant you activated it, so
                focus fell to <body> and reaching "Next question" meant tabbing
                from the top of the document — twice per question. This keeps
                the answered choices readable and reviewable by keyboard while
                refusing a second answer.
              */}
              <button
                type="button"
                aria-disabled={reveal}
                onClick={() => {
                  if (reveal) return;
                  setPicked(c);
                  if (c === q.correctAnswer) setRight((n) => n + 1);
                }}
                className={cn(
                  'console-focusable flex w-full items-center gap-3 rounded-2xl border px-5 py-4 text-left text-[15px] transition-colors',
                  !reveal && 'border-white/[0.10] bg-white/[0.03] hover:bg-white/[0.06]',
                  reveal && 'cursor-default',
                  reveal && isAnswer && 'border-success/45 bg-success/[0.10]',
                  reveal && chosen && !isAnswer && 'border-destructive/45 bg-destructive/[0.08]',
                  reveal && !isAnswer && !chosen && 'border-white/[0.06] text-quiet',
                )}
              >
                <span className="min-w-0 flex-1">{c}</span>
                {/*
                  Which choice was right was carried by border colour and an
                  aria-hidden glyph — so re-reading the list with a screen
                  reader after answering told you nothing (SC 1.4.1). The
                  words are there now; the colour is the redundant part.
                */}
                {reveal && isAnswer && (
                  <>
                    <span className="sr-only">Correct answer</span>
                    <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />
                  </>
                )}
                {reveal && chosen && !isAnswer && (
                  <>
                    <span className="sr-only">Your answer, incorrect</span>
                    <X aria-hidden className="h-4 w-4 shrink-0 text-destructive" />
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* The explanation is the point. It arrives for right answers too. */}
      <AnimatePresence initial={false}>
        {graded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/*
              The explanation appears without navigation, so it has to be
              announced. `role="status"` rather than `aria-live="assertive"`:
              it is information you asked for by answering, not an alert.
              Focus moves here too, so the next Tab lands on "Next question"
              instead of restarting from the top of the document.
            */}
            <div
              ref={explanationRef}
              role="status"
              aria-live="polite"
              tabIndex={-1}
              className="console-focusable mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5"
            >
              <p className="mb-1.5 text-[13px] font-medium text-quiet">
                {graded.correct ? 'Right' : 'Not quite'}
              </p>
              <p className="text-[15px] leading-relaxed text-foreground">{graded.explanation}</p>
            </div>

            <Pressable
              type="button"
              onClick={() => {
                if (isLast) return setDone(true);
                setIndex((i) => i + 1);
                setPicked(null);
              }}
              className="console-focusable mt-5 flex h-12 w-full items-center justify-center rounded-full bg-white text-[14.5px] font-semibold text-slate-900"
            >
              {isLast ? 'See how you did' : 'Next question'}
            </Pressable>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
  );
}
