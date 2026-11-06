import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, CornerDownLeft, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pressable } from '../components/Pressable';
import { gradeAnswer, submitAnswer, usePracticeQuestions, type PracticeQuestion } from '../data/practice';
import { isLive } from '../data/useReader';
import { Scene, SURFACES } from '../components/Scene';
import { ghostPill, stageAccentFor, stageCard } from '../components/stage';
import { useScreenState } from '../data/useSpaces';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { ReaderExit } from '../components/reader/ReaderHeader';
import { PracticeLanguageNote } from '../components/PracticeLanguageNote';
import { spaceById, visibleLesson } from '../data/world';

/**
 * Practice for one Lesson.
 *
 * You are working, so the console texture comes off and the top bar goes with
 * it — one question, its choices, nothing else competing. It stands on the
 * stage all the same: the Lesson's black, the Space's own light above, white
 * pill, hairline cards — so walking in from the Lesson feels like the same
 * room with the lights lowered, not a different app.
 *
 * What makes it a place to learn rather than a quiz:
 *   • **The light is the progress.** No bar and no counter. Each question is
 *     a segment that lights in the Space's colour when it holds, and the
 *     light above the question grows with it. You see how far you are; you
 *     never read a number.
 *   • **What you miss comes back.** A wrong answer is asked once more at the
 *     end, choices reordered — a second retrieval is where it sticks, and the
 *     explanation you just read is fresh. Its segment lights softer: held, on
 *     a second look.
 *   • **It never moves on before explaining.** Every answer, right or wrong,
 *     shows why, and a guard enforces that every question carries one.
 *   • **Hands stay on the keys.** 1–4 answers, Enter moves on, Escape leaves.
 *
 * And what it refuses: scoring you. The light goes nowhere — it feeds no
 * standing and clears nothing on the map (Abi, 2026-08-31). It is a place to
 * be wrong safely. Live, the server logs each attempt and grants a question's
 * XP once, the first time it is right — the same rule as the reader's plane.
 */

type Mark = 'pending' | 'held' | 'second' | 'again' | 'missed';

interface Turn {
  q: PracticeQuestion;
  choices: string[];
  /** The second look at a question missed the first time. */
  second: boolean;
}

/**
 * Explanations are written with `*emphasis*` (the backend's sheets too), and
 * the asterisks were reaching the screen. Only that one mark is honoured —
 * this is prose, not a Markdown surface.
 */
const withEmphasis = (text: string) =>
  text.split(/\*([^*]+)\*/g).map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part));

/** Same choices, a different order — so a second look tests the idea, not where it sat. */
const reorder = (choices: string[]) => [...choices.slice(1), choices[0]];

export default function PracticeScreen() {
  const { t } = useTranslation('v4Space');
  const screenState = useScreenState();
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const navigate = useNavigate();
  const space = spaceId ? spaceById(spaceId) : undefined;
  const lesson = useMemo(
    () => (space && lessonId ? visibleLesson(space, lessonId) : undefined),
    [space, lessonId],
  );
  // Live: the lecture's real quiz questions, and every answer is recorded on
  // the server (the attempt, and XP once per question — as in the reader).
  const live = isLive(spaceId, lessonId);
  const practice = usePracticeQuestions(lessonId, live);
  const questions = practice.questions;
  const accent = space ? stageAccentFor(space.name.length) : null;

  const firstTurns = useMemo<Turn[]>(
    () => questions.map((q) => ({ q, choices: q.choices, second: false })),
    [questions],
  );
  const [turns, setTurns] = useState<Turn[]>(firstTurns);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [done, setDone] = useState(false);
  /** Bumped on every right answer: the light answers back. */
  const [flash, setFlash] = useState(0);

  const restart = useCallback(() => {
    setTurns(firstTurns);
    setIndex(0);
    setPicked(null);
    setMarks({});
    setDone(false);
    setFlash(0);
  }, [firstTurns]);

  /*
   * Answer state belongs to one Lesson, and React does not know that.
   *
   * `Scene` guarantees no remount ("one tree, always"), and both practice URLs
   * resolve to the same element at the same router position — so moving from
   * one Lesson's practice to another reused the mount and kept the old turn,
   * marks and `done`. With `index` past the end of a shorter set,
   * `turns[index]` was `undefined` and reading `.prompt` threw.
   *
   * Resetting in an effect rather than with a `key` on the route, because the
   * no-remount guarantee is load-bearing elsewhere and worth keeping.
   */
  useEffect(() => {
    restart();
  }, [restart]);

  const explanationRef = useRef<HTMLDivElement>(null);
  // Answering replaces what matters on screen; move focus to it.
  useEffect(() => {
    if (picked) explanationRef.current?.focus();
  }, [picked]);

  const turn = turns[index] as Turn | undefined;
  const isLast = index === turns.length - 1;

  const answer = useCallback(
    (choice: string) => {
      if (!turn || picked) return;
      setPicked(choice);
      if (live && lessonId) submitAnswer(lessonId, turn.q, choice).catch(() => {});
      const right = choice === turn.q.correctAnswer;
      if (right) setFlash((n) => n + 1);
      setMarks((m) => ({
        ...m,
        [turn.q.id]: turn.second ? (right ? 'second' : 'missed') : right ? 'held' : 'again',
      }));
      // Missed the first time: it comes back once, at the end.
      if (!right && !turn.second) {
        setTurns((ts) => [...ts, { q: turn.q, choices: reorder(turn.choices), second: true }]);
      }
    },
    [turn, picked, live, lessonId],
  );

  const advance = useCallback(() => {
    if (!picked) return;
    // A miss queued by this answer has already re-rendered into `turns`,
    // so `isLast` is false whenever a second look is still to come.
    if (isLast) return setDone(true);
    setIndex((i) => i + 1);
    setPicked(null);
  }, [picked, isLast]);

  /*
   * The keys. Escape leaves — a full-bleed surface with the chrome stripped
   * and one X to exit is exactly where a hand reaches for it. 1–4 answer and
   * Enter moves on, unless focus is on a control that already handles Enter
   * itself (it would fire twice and skip a question).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && space && lesson) {
        navigate(`/v4/space/${space.id}/lesson/${lesson.id}`);
        return;
      }
      if (done || !turn) return;
      const n = Number(e.key);
      if (!picked && Number.isInteger(n) && n >= 1 && n <= turn.choices.length) {
        e.preventDefault();
        answer(turn.choices[n - 1]);
        return;
      }
      const onControl = (e.target as HTMLElement | null)?.closest('button, a, input, textarea');
      if (picked && !onControl && (e.key === 'Enter' || e.key === 'ArrowRight')) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, space, lesson, done, turn, picked, answer, advance]);

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.practice} motionKey={`practice-${lessonId}`}>
      {body}
    </Scene>
  );

  // All four states, on every screen.
  if (screenState === 'loading' || practice.state === 'loading') return chrome(<DetailSkeleton />);
  if (screenState === 'error') return chrome(<SpacesError what="practice" />);

  /* Not here beats "connection dropped": an unknown Lesson's practice answers 404 too (LS-061). */
  if (!space || !lesson)
    return chrome(
      <NotFound
        what="lesson"
        back={space ? { to: `/v4/space/${space.id}`, space: space.name } : { to: '/v4/spaces', place: 'spaces' }}
      />,
    );
  if (practice.state === 'error')
    return chrome(
      <>
        {/* A way out besides "Try again", as the reader has. */}
        <ReaderExit to={`/v4/space/${space.id}/lesson/${lesson.id}`} />
        <SpacesError what="practice" />
      </>,
    );

  const backToLesson = `/v4/space/${space.id}/lesson/${lesson.id}`;

  if (questions.length === 0) {
    return chrome(
      <div className="relative mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <Sky accent={accent} level={0} flash={0} />
        <p className="mb-2 text-[17px] font-semibold">{t('practiceScreen.empty.title')}</p>
        <p className="mb-7 text-[14.5px] leading-relaxed text-quiet">
          {t('practiceScreen.empty.body', { lesson: lesson.title })}
        </p>
        <Link to={backToLesson} className={ghostPill}>
          <ArrowLeft aria-hidden className="h-4 w-4" />
          {t('practiceScreen.backToLesson')}
        </Link>
      </div>,
    );
  }

  const markList: Mark[] = questions.map((q) => marks[q.id] ?? 'pending');
  const heldCount = markList.filter((m) => m === 'held' || m === 'second').length;
  const level = heldCount / questions.length;

  if (done) {
    const firstTime = markList.filter((m) => m === 'held').length;
    const stillMissed = questions.filter((q) => marks[q.id] === 'missed');
    const verdictKey =
      firstTime === questions.length ? 'allHeld' : stillMissed.length === 0 ? 'heldSecond' : 'nearly';
    const verdict = {
      title: t(`practiceScreen.verdict.${verdictKey}.title`),
      lede: t(`practiceScreen.verdict.${verdictKey}.lede`),
    };

    return chrome(
      <div className="relative mx-auto flex min-h-[78vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <Sky accent={accent} level={level} flash={flash} />
        <p className="text-[13px] text-quiet">{lesson.title}</p>
        <h1 className="mt-3 text-[40px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[52px]">
          {verdict.title}
        </h1>
        <Lights marks={markList} accent={accent} size="lg" className="mt-8 w-full max-w-xs" />
        <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-quiet">{verdict.lede}</p>

        {stillMissed.length > 0 && (
          <ul className="mt-8 w-full space-y-2.5 text-left">
            {stillMissed.map((q) => (
              <li key={q.id} className={cn(stageCard, 'p-5')}>
                <p className="text-[15px] font-medium leading-snug">{q.prompt}</p>
                <p className="mt-2 text-[14px] leading-relaxed text-quiet">
                  <span className="text-foreground">{q.correctAnswer}.</span> {withEmphasis(q.explanation)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Pressable
            type="button"
            onClick={restart}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-black"
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            {t('practiceScreen.again')}
          </Pressable>
          <Link to={backToLesson} className={ghostPill}>
            {t('practiceScreen.backToLesson')}
          </Link>
        </div>
      </div>,
    );
  }

  if (!turn) return chrome(<DetailSkeleton />);

  const graded = picked ? gradeAnswer(turn.q, picked) : null;

  return chrome(
    <div className="relative mx-auto max-w-2xl px-6 py-8">
      <Sky accent={accent} level={level} flash={flash} />

      {/* Minimal chrome: a way out, where you are, and the light so far. */}
      <div className="relative mb-12 flex items-center gap-4">
        <Link
          to={backToLesson}
          aria-label={t('practiceScreen.leave')}
          className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-quiet">
            {lesson.title}
            {turn.second && <span className="text-foreground"> · {t('practiceScreen.secondLook')}</span>}
          </p>
          <Lights
            marks={markList}
            current={turn.q.id}
            questions={questions}
            accent={accent}
            className="mt-2.5"
          />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${turn.q.id}-${turn.second ? 2 : 1}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="relative"
        >
          <PracticeLanguageNote language={turn.q.language} />
          <h1 lang={turn.q.language} className="text-[26px] font-medium leading-snug tracking-[-0.015em] sm:text-[30px]">{turn.q.prompt}</h1>

          <ul className="mt-8 space-y-2.5">
            {turn.choices.map((c, i) => {
              const chosen = picked === c;
              const isAnswer = c === turn.q.correctAnswer;
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
                  <motion.button
                    type="button"
                    aria-disabled={reveal}
                    aria-keyshortcuts={String(i + 1)}
                    onClick={() => answer(c)}
                    animate={reveal && chosen && !isAnswer ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
                    transition={{ duration: 0.35 }}
                    className={cn(
                      'console-focusable group flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left text-[15px] transition-colors',
                      !reveal && 'border-white/[0.10] bg-white/[0.03] hover:border-white/[0.18] hover:bg-white/[0.06]',
                      reveal && 'cursor-default',
                      reveal && isAnswer && 'border-success/45 bg-success/[0.10]',
                      reveal && chosen && !isAnswer && 'border-destructive/45 bg-destructive/[0.08]',
                      reveal && !isAnswer && !chosen && 'border-white/[0.06] text-quiet',
                    )}
                  >
                    <kbd
                      aria-hidden
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-sans text-[12px] tabular-nums transition-colors',
                        reveal
                          ? 'border-transparent text-faint'
                          : 'border-white/[0.12] text-quiet group-hover:border-white/25 group-hover:text-foreground',
                      )}
                    >
                      {i + 1}
                    </kbd>
                    <span lang={turn.q.language} className="min-w-0 flex-1">{c}</span>
                    {/*
                      Which choice was right was carried by border colour and an
                      aria-hidden glyph — so re-reading the list with a screen
                      reader after answering told you nothing (SC 1.4.1). The
                      words are there now; the colour is the redundant part.
                    */}
                    {reveal && isAnswer && (
                      <>
                        <span className="sr-only">{t('practiceScreen.correctAnswer')}</span>
                        <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />
                      </>
                    )}
                    {reveal && chosen && !isAnswer && (
                      <>
                        <span className="sr-only">{t('practiceScreen.wrongAnswer')}</span>
                        <X aria-hidden className="h-4 w-4 shrink-0 text-destructive" />
                      </>
                    )}
                  </motion.button>
                </li>
              );
            })}
          </ul>

          {/* The explanation is the point. It arrives for right answers too. */}
          <AnimatePresence initial={false}>
            {graded && (
              <motion.div
                /*
                  Opacity and a small drift, not `height: 0 → auto` — height is a
                  layout property and would drag the page below it every frame.
                */
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                {/*
                  Announced, because it appears without navigation. `status`,
                  not an alert: it is what you asked for by answering. Focus
                  lands here, so the next Tab reaches "Next question".
                */}
                <div
                  ref={explanationRef}
                  role="status"
                  aria-live="polite"
                  tabIndex={-1}
                  className={cn(stageCard, 'console-focusable mt-6 p-5')}
                >
                  <p className="mb-1.5 text-[13px] font-medium text-quiet">
                    {t(
                      graded.correct
                        ? turn.second
                          ? 'practiceScreen.feedback.rightHeld'
                          : 'practiceScreen.feedback.right'
                        : turn.second
                          ? 'practiceScreen.feedback.notYet'
                          : 'practiceScreen.feedback.comesBack',
                    )}
                  </p>
                  <p lang={turn.q.language} className="text-[15px] leading-relaxed text-foreground">{withEmphasis(graded.explanation)}</p>
                </div>

                <Pressable
                  type="button"
                  onClick={advance}
                  className="console-focusable mt-5 flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-white text-[14.5px] font-semibold text-black"
                >
                  {isLast ? t('practiceScreen.seeHow') : t('practiceScreen.next')}
                  <CornerDownLeft aria-hidden className="h-3.5 w-3.5 opacity-40" />
                </Pressable>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>,
  );
}

/**
 * The light above the question: the Space's own colour, faint when you walk
 * in and fuller with every answer that holds. A right answer sends a brief
 * swell through it — the room noticing, not a reward.
 *
 * Two layers rather than one animated gradient: a gradient's stops cannot be
 * tweened, its opacity can, and opacity stays on the compositor.
 */
function Sky({ accent, level, flash }: { accent: string | null; level: number; flash: number }) {
  const c = accent ?? 'hsl(var(--secondary))';
  const glow = (pct: number) => `radial-gradient(55% 70% at 50% 0%, color-mix(in srgb, ${c} ${pct}%, transparent), transparent 72%)`;
  return (
    <div aria-hidden className="pointer-events-none absolute -top-8 left-1/2 h-[460px] w-screen -translate-x-1/2">
      <div className="absolute inset-0" style={{ background: glow(9) }} />
      <motion.div
        className="absolute inset-0"
        style={{ background: glow(30) }}
        initial={false}
        animate={{ opacity: level }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      {flash > 0 && (
        <motion.div
          key={flash}
          className="absolute inset-0"
          style={{ background: glow(38) }}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
        />
      )}
    </div>
  );
}

/**
 * One segment per question, lit in the Space's colour as it holds — softer
 * when it held on a second look. It is the progress bar and the tally at
 * once, so neither has to be said in numbers.
 */
function Lights({
  marks,
  current,
  questions,
  accent,
  size = 'sm',
  className,
}: {
  marks: Mark[];
  current?: string;
  questions?: PracticeQuestion[];
  accent: string | null;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const { t } = useTranslation('v4Space');
  const c = accent ?? '#ffffff';
  const held = marks.filter((m) => m === 'held' || m === 'second').length;
  const settled = marks.filter((m) => m === 'held' || m === 'second' || m === 'missed').length;
  return (
    <div
      role="progressbar"
      aria-label={t('practiceScreen.progress.label')}
      aria-valuemin={0}
      aria-valuemax={marks.length}
      aria-valuenow={settled}
      aria-valuetext={t('practiceScreen.progress.value', { held, total: marks.length })}
      className={cn('flex items-center gap-1.5', className)}
    >
      {marks.map((m, i) => {
        const isCurrent = questions?.[i]?.id === current;
        const lit = m === 'held' || m === 'second';
        return (
          <span
            key={i}
            className={cn(
              'relative flex-1 overflow-hidden rounded-full bg-white/[0.09]',
              size === 'lg' ? 'h-2' : 'h-1.5',
              m === 'again' && 'bg-transparent ring-1 ring-inset ring-white/25',
            )}
          >
            <motion.span
              className="absolute inset-0 rounded-full"
              initial={false}
              animate={{ scaleX: lit ? 1 : 0, opacity: m === 'second' ? 0.55 : 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{
                transformOrigin: 'left',
                background: c,
                boxShadow: lit ? `0 0 12px color-mix(in srgb, ${c} 70%, transparent)` : undefined,
              }}
            />
            {isCurrent && !lit && (
              <motion.span
                className="absolute inset-0 rounded-full bg-white/40"
                animate={{ opacity: [0.35, 0.9, 0.35] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
