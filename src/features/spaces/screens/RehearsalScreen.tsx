import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpen, Check, RotateCcw, Sparkles, Target, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Scene, SURFACES } from '../components/Scene';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { QuestionView } from '../components/rehearsal/QuestionView';
import { grade, type Grade } from '../components/rehearsal/grade';
import { composeRehearsal, saveRehearsal, useCourse, useRehearsalHistory } from '../data/useReader';
import { fadingIdeas, type FadingIdea } from '../components/course/today';
import type { Rehearsal, RehearsalHistory } from '../data/liveRepository';

/**
 * Exam rehearsal, for a real course.
 *
 * Pick lectures and a length; the model writes a short mixed test from those
 * lectures' own slides — choice, ordering, and the database tools (which FDs
 * hold on a table, a closure, BCNF violations), the tools graded by
 * computing the answer. One question at a time; after each, what was right,
 * why, and the page that teaches it. At the end, the debrief: a score, how
 * each lecture went, the ideas to read again — and a second rehearsal aimed
 * at exactly those.
 *
 * A focus surface: no top bar, one thing at a time, a way out in the corner.
 */

type Phase =
  | { at: 'setup' }
  | { at: 'composing'; lectures: string[] }
  | { at: 'failed'; message: string; retry: () => void }
  | { at: 'running'; rehearsal: Rehearsal; index: number; grades: (Grade | null)[] }
  | { at: 'done'; rehearsal: Rehearsal; grades: Grade[]; saved: 'saving' | 'saved' | 'failed' };

const LENGTHS = [5, 8, 12];

export default function RehearsalScreen({ courseId }: { courseId: string }) {
  const { state, course } = useCourse(courseId);
  const [params] = useSearchParams();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>({ at: 'setup' });
  const [picked, setPicked] = useState<string[] | null>(null);
  const [count, setCount] = useState(8);
  const { history, reload } = useRehearsalHistory(courseId);

  /* Every question, and every phase, starts at the top of the page. */
  const step = phase.at === 'running' ? `q${phase.index}` : phase.at;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  /* Preselect from `?lectures=` (a lecture's "rehearse this"), else every lecture. */
  useEffect(() => {
    if (!course || picked) return;
    const asked = params.get('lectures')?.split(',').filter((id) => course.lectures.some((l) => l.id === id));
    setPicked(asked?.length ? asked : course.lectures.map((l) => l.id));
  }, [course, picked, params]);

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.rehearsal} motionKey={`rehearse-${courseId}`}>
      <Link
        to={`/v4/space/${courseId}`}
        aria-label="Leave the rehearsal"
        className="console-focusable fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <X aria-hidden className="h-4 w-4" />
      </Link>
      <div className="relative min-h-[100dvh]">{body}</div>
    </Scene>
  );

  if (state === 'loading') return chrome(<DetailSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="this Space" />);
  if (!course) return chrome(<NotFound what="Space" backTo="/v4/spaces" backLabel="Back to Spaces" />);

  const pageHref = (lectureId: string, page: number) => `/v4/space/${course.id}/lesson/${lectureId}/faces?page=${page}&view=explain`;

  const start = (lectureIds: string[], weak: string[] = [], n = count) => {
    setPhase({ at: 'composing', lectures: lectureIds });
    composeRehearsal(course.id, lectureIds, n, weak)
      .then((r) => setPhase({ at: 'running', rehearsal: r, index: 0, grades: r.questions.map(() => null) }))
      .catch(() =>
        setPhase({
          at: 'failed',
          message: weak.length
            ? 'Couldn’t write the rehearsal on your weak spots just now. The model may be busy.'
            : 'Couldn’t write a rehearsal just now. The model may be busy.',
          // The same request again — weak spots included — not a fresh setup.
          retry: () => start(lectureIds, weak, n),
        }),
      );
  };

  /* ── setup ── */
  if (phase.at === 'setup' || phase.at === 'failed') {
    const chosen = picked ?? [];
    return chrome(
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-24">
        <p className="mb-3 flex items-center gap-2 text-[13px] text-quiet">
          <Target aria-hidden className="h-4 w-4" />
          {course.title}
        </p>
        <h1 className="text-[40px] font-medium leading-[1.05] tracking-[-0.03em] sm:text-[56px]">Rehearse for the exam</h1>
        <p className="mt-4 max-w-[54ch] text-[16px] leading-relaxed text-quiet">
          A short test from your own pages. Every answer points back to the page that teaches it.
        </p>

        {history && history.attempts.length > 0 && (
          <HistoryPanel
            history={history}
            pageHref={pageHref}
            fading={fadingIdeas(course, history)}
            onRehearseFading={(ideas) =>
              start(
                [...new Set(ideas.map((f) => f.lectureId))],
                ideas.map((f) => f.name),
                Math.max(5, Math.min(8, ideas.length * 2)),
              )
            }
            onRehearseWeak={() =>
              start(
                [...new Set(history.weak.map((w) => w.lecture_id))],
                history.weak.map((w) => w.idea),
                Math.max(5, Math.min(8, history.weak.length * 2)),
              )
            }
          />
        )}

        <div className="mt-12">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-[15px] font-medium text-foreground">Lessons</p>
            <button
              type="button"
              onClick={() => setPicked(chosen.length === course.lectures.length ? [] : course.lectures.map((l) => l.id))}
              className="console-focusable rounded-md px-1 text-[13px] text-quiet transition-colors hover:text-foreground"
            >
              {chosen.length === course.lectures.length ? 'Clear' : 'All'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {course.lectures.map((l) => {
              const on = chosen.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((p) => ((p ?? []).includes(l.id) ? (p ?? []).filter((x) => x !== l.id) : [...(p ?? []), l.id]))}
                  className={cn(
                    'console-focusable flex h-10 items-center gap-2 rounded-full px-4 text-[14px] transition-colors',
                    on ? 'bg-white text-background' : 'bg-white/[0.05] text-quiet hover:bg-white/[0.09] hover:text-foreground',
                  )}
                >
                  <span className="tabular-nums opacity-60">{l.order}</span>
                  {l.title}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-10">
          <p className="mb-3 text-[15px] font-medium text-foreground">Length</p>
          <div role="radiogroup" aria-label="Number of questions" className="inline-flex rounded-full bg-white/[0.06] p-1">
            {LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => setCount(n)}
                className={cn(
                  'console-focusable relative h-9 rounded-full px-5 text-[14px] transition-colors',
                  count === n ? 'text-background' : 'text-quiet hover:text-foreground',
                )}
              >
                {count === n && (
                  <motion.span layoutId="rehearse-length" transition={{ duration: 0.2 }} className="absolute inset-0 rounded-full bg-white" />
                )}
                <span className="relative">{n} questions</span>
              </button>
            ))}
          </div>
        </div>

        {phase.at === 'failed' && (
          <div role="alert" className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3">
            <p className="flex-1 text-[14px] text-foreground">{phase.message}</p>
            <button
              type="button"
              onClick={phase.retry}
              className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13.5px] font-medium text-background"
            >
              <RotateCcw aria-hidden className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() => start(chosen)}
          className="console-focusable mt-12 inline-flex h-14 items-center gap-2.5 rounded-full bg-white px-8 text-[16px] font-medium text-background transition-colors disabled:bg-white/[0.12] disabled:text-faint"
        >
          <Sparkles aria-hidden className="h-4 w-4" />
          Write my rehearsal
        </button>
      </div>,
    );
  }

  /* ── composing ── */
  if (phase.at === 'composing') {
    return chrome(<Composing titles={phase.lectures.map((id) => course.lectures.find((l) => l.id === id)?.title ?? '')} reduce={!!reduce} />);
  }

  /* ── running ── */
  if (phase.at === 'running') {
    const { rehearsal, index, grades } = phase;
    const q = rehearsal.questions[index];
    const g = grades[index];
    const last = index === rehearsal.questions.length - 1;
    const next = () => {
      if (!last) return setPhase({ ...phase, index: index + 1 });
      const done = grades as Grade[];
      setPhase({ at: 'done', rehearsal, grades: done, saved: 'saving' });
      /* Into your history: what each question tested, and whether it was right. */
      saveRehearsal(
        course.id,
        rehearsal.title,
        Object.keys(rehearsal.lectures),
        rehearsal.questions.map((q, i) => ({
          lecture_id: q.lecture_id,
          page: q.page,
          idea: q.idea,
          kind: q.kind,
          correct: done[i].correct,
        })),
      )
        .then(() => {
          reload();
          setPhase((p) => (p.at === 'done' ? { ...p, saved: 'saved' } : p));
        })
        .catch(() => setPhase((p) => (p.at === 'done' ? { ...p, saved: 'failed' } : p)));
    };
    return chrome(
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-20">
        <div aria-hidden className="mb-10 flex gap-1.5">
          {rehearsal.questions.map((x, i) => (
            <span
              key={x.id}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                grades[i] ? (grades[i]!.correct ? 'bg-success' : 'bg-destructive') : i === index ? 'bg-white/[0.6]' : 'bg-white/[0.1]',
              )}
            />
          ))}
        </div>
        <p className="mb-6 text-[13px] tabular-nums text-quiet">
          Question {index + 1} of {rehearsal.questions.length}
        </p>
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
          >
            <QuestionView
              q={q}
              lectureTitle={rehearsal.lectures[q.lecture_id] ?? ''}
              pageHref={pageHref(q.lecture_id, q.page)}
              graded={g}
              onCheck={(a) => setPhase({ ...phase, grades: grades.map((x, i) => (i === index ? grade(q, a) : x)) })}
            />
          </motion.div>
        </AnimatePresence>
        {g && (
          <button
            type="button"
            onClick={next}
            className="console-focusable mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[15px] font-medium text-background"
          >
            {last ? 'See how it went' : 'Next question'}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>,
    );
  }

  /* ── done: the debrief ── */
  return chrome(<Debrief phase={phase} course={course} pageHref={pageHref} onAgain={start} onNew={() => setPhase({ at: 'setup' })} />);
}

/** Waiting, made to feel like something is being written for you — because it is. */
function Composing({ titles, reduce }: { titles: string[]; reduce: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || titles.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % titles.length), 1600);
    return () => clearInterval(t);
  }, [titles.length, reduce]);
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center" role="status">
      <motion.div
        aria-hidden
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        className="mb-10 h-20 w-20 rounded-full border border-white/[0.08] border-t-white/[0.7]"
      />
      <p className="text-[28px] font-medium tracking-[-0.02em]">Writing your rehearsal</p>
      <p className="mt-3 h-6 text-[15px] text-quiet">
        Reading{' '}
        <AnimatePresence mode="wait">
          <motion.span
            key={titles[i]}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="inline-block text-foreground"
          >
            {titles[i]}
          </motion.span>
        </AnimatePresence>
      </p>
      <p className="mt-10 text-[13px] text-faint">Usually about half a minute.</p>
    </div>
  );
}

function Debrief({
  phase,
  course,
  pageHref,
  onAgain,
  onNew,
}: {
  phase: Extract<Phase, { at: 'done' }>;
  course: { id: string; title: string };
  pageHref: (lectureId: string, page: number) => string;
  onAgain: (lectureIds: string[], weak: string[], n?: number) => void;
  onNew: () => void;
}) {
  const { rehearsal, grades } = phase;
  const right = grades.filter((g) => g.correct).length;
  const total = grades.length;
  const ratio = total ? right / total : 0;
  const missed = rehearsal.questions.filter((_, i) => !grades[i].correct);

  const byLecture = useMemo(() => {
    const m = new Map<string, { right: number; total: number }>();
    rehearsal.questions.forEach((q, i) => {
      const e = m.get(q.lecture_id) ?? { right: 0, total: 0 };
      e.total += 1;
      if (grades[i].correct) e.right += 1;
      m.set(q.lecture_id, e);
    });
    return [...m.entries()];
  }, [rehearsal, grades]);

  const R = 64;
  const C = 2 * Math.PI * R;
  const verdict =
    ratio === 1 ? 'Flawless.' : ratio >= 0.75 ? 'Strong — a couple of ideas to tighten.' : ratio >= 0.5 ? 'Getting there.' : 'Worth another pass.';

  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-20">
      <div className="flex flex-col items-center text-center">
        <p aria-live="polite" className="mb-4 h-5 text-[12.5px] text-faint">
          {phase.saved === 'saving' ? 'Saving to your history…' : phase.saved === 'saved' ? 'Saved to your history' : 'Couldn’t save this one to your history'}
        </p>
        <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden>
          <circle cx={80} cy={80} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
          <motion.circle
            cx={80}
            cy={80}
            r={R}
            fill="none"
            stroke={ratio >= 0.75 ? 'hsl(var(--success))' : ratio >= 0.5 ? 'hsl(var(--secondary))' : 'hsl(var(--destructive))'}
            strokeWidth={10}
            strokeLinecap="round"
            transform="rotate(-90 80 80)"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - ratio) }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <p className="-mt-[104px] mb-[56px] text-[40px] font-medium tabular-nums">
          {right}
          <span className="text-[22px] text-quiet">/{total}</span>
        </p>
        <h1 className="text-[32px] font-medium tracking-[-0.02em]">{verdict}</h1>
        <p className="mt-2 text-[14px] text-quiet">{rehearsal.title}</p>
      </div>

      <section aria-label="By Lesson" className="mt-12 space-y-3">
        {byLecture.map(([id, s]) => (
          <div key={id} className="flex items-center gap-4">
            <span className="w-40 shrink-0 truncate text-[14px] text-foreground">{rehearsal.lectures[id]}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.span
                className="block h-full origin-left rounded-full bg-white"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: s.total ? s.right / s.total : 0 }}
                transition={{ duration: 0.8 }}
              />
            </span>
            <span className="w-12 text-right text-[13px] tabular-nums text-quiet">
              {s.right}/{s.total}
            </span>
          </div>
        ))}
      </section>

      {missed.length > 0 && (
        <section aria-label="Read again" className="mt-12">
          <h2 className="mb-3 text-[18px] font-medium">Read again</h2>
          <ul className="space-y-2">
            {missed.map((q) => (
              <li key={q.id}>
                <Link
                  to={pageHref(q.lecture_id, q.page)}
                  className="console-focusable group flex items-center gap-4 rounded-2xl border border-white/[0.08] px-4 py-3 transition-colors hover:bg-white/[0.04]"
                >
                  <BookOpen aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-foreground">{q.idea}</span>
                    <span className="block text-[12.5px] text-quiet">
                      {rehearsal.lectures[q.lecture_id]} · page {q.page}
                    </span>
                  </span>
                  <ArrowRight aria-hidden className="h-4 w-4 text-faint transition-colors group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12 flex flex-wrap gap-3">
        {missed.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onAgain(
                [...new Set(missed.map((q) => q.lecture_id))],
                [...new Set(missed.map((q) => q.idea))],
                Math.max(5, Math.min(8, missed.length * 2)),
              )
            }
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-background"
          >
            <Target aria-hidden className="h-4 w-4" />
            Rehearse my weak spots
          </button>
        )}
        <button
          type="button"
          onClick={onNew}
          className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/[0.12] px-6 text-[15px] text-foreground transition-colors hover:bg-white/[0.05]"
        >
          <RotateCcw aria-hidden className="h-4 w-4" />
          New rehearsal
        </button>
        <Link
          to={`/v4/space/${course.id}`}
          className="console-focusable inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] text-quiet transition-colors hover:text-foreground"
        >
          {right === total && <Check aria-hidden className="h-4 w-4 text-success" />}
          Back to {course.title}
        </Link>
      </div>
    </div>
  );
}

/** Your rehearsals so far: the scores over time, and the ideas you keep missing. */
function HistoryPanel({
  history,
  pageHref,
  fading,
  onRehearseFading,
  onRehearseWeak,
}: {
  history: RehearsalHistory;
  pageHref: (lectureId: string, page: number) => string;
  fading: FadingIdea[];
  onRehearseFading: (ideas: FadingIdea[]) => void;
  onRehearseWeak: () => void;
}) {
  const recent = [...history.attempts].slice(0, 10).reverse();
  const latest = history.attempts[0];
  const ago = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };
  return (
    <section aria-label="Your rehearsals" className="mt-12 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[15px] font-medium text-foreground">Your rehearsals</p>
          <p className="mt-1 text-[13px] tabular-nums text-quiet">
            {history.attempts.length} so far · last {latest.score}/{latest.total}, {ago(latest.created_at)}
          </p>
        </div>
        {/* Scores over time, oldest to newest. */}
        <div aria-hidden className="flex h-12 items-end gap-1.5">
          {recent.map((a) => {
            const r = a.score / a.total;
            return (
              <span
                key={a.id}
                className={cn('w-3 rounded-sm', r >= 0.75 ? 'bg-success' : r >= 0.5 ? 'bg-white/[0.6]' : 'bg-destructive/80')}
                style={{ height: `${Math.max(12, r * 100)}%` }}
              />
            );
          })}
        </div>
      </div>

      {history.weak.length > 0 ? (
        <div className="mt-6">
          <p className="mb-2.5 text-[13px] text-quiet">Ideas you missed last time</p>
          {/* Grouped by lecture, so each lecture is named once. */}
          <div className="space-y-3">
            {[...new Set(history.weak.map((w) => w.lecture_id))].map((lid) => {
              const group = history.weak.filter((w) => w.lecture_id === lid);
              return (
                <div key={lid} className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[12.5px] text-faint">{group[0].lecture_title}</span>
                  {group.map((w) => (
                    <Link
                      key={`${w.lecture_id}-${w.idea}`}
                      to={pageHref(w.lecture_id, w.page)}
                      title={`Page ${w.page}`}
                      className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-destructive/[0.1] px-3.5 text-[13px] text-foreground transition-colors hover:bg-destructive/[0.18]"
                    >
                      {w.idea}
                      {w.missed > 1 && <span className="text-[12px] text-quiet">missed {w.missed}×</span>}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onRehearseWeak}
            className="console-focusable mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-medium text-background"
          >
            <Target aria-hidden className="h-4 w-4" />
            {history.weak.length === 1 ? 'Rehearse this one' : 'Rehearse these'}
          </button>
        </div>
      ) : (
        fading.length === 0 && (
          <p className="mt-6 flex items-center gap-2 text-[13.5px] text-quiet">
            <Check aria-hidden className="h-4 w-4 text-success" />
            No weak spots: everything you were asked last time, you got right.
          </p>
        )
      )}

      {/* What you knew, but not lately: the light fades after a week. */}
      {fading.length > 0 && (
        <div className="mt-7">
          <p className="mb-2.5 text-[13px] text-quiet">Fading — right more than a week ago</p>
          <div className="flex flex-wrap gap-2">
            {fading.map((f) => (
              <Link
                key={`${f.lectureId}-${f.page}`}
                to={pageHref(f.lectureId, f.page)}
                title={`${f.lectureTitle}, page ${f.page}`}
                className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-success/[0.07] px-3.5 text-[13px] text-foreground transition-colors hover:bg-success/[0.14]"
              >
                {f.name}
                <span className="text-[12px] tabular-nums text-quiet">{f.days} days</span>
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onRehearseFading(fading)}
            className={cn(
              'console-focusable mt-5 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors',
              history.weak.length > 0 ? 'bg-white/[0.08] text-foreground hover:bg-white/[0.14]' : 'bg-white text-background',
            )}
          >
            <Sparkles aria-hidden className="h-4 w-4" />
            Refresh these
          </button>
        </div>
      )}
    </section>
  );
}
