import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, PenLine, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Checkpoint } from '../../data/liveRepository';
import { QuestionView } from '../rehearsal/QuestionView';
import { grade, type Answer, type Grade } from '../rehearsal/grade';

/**
 * A checkpoint at the end of an idea.
 *
 * You turn past the last page of an idea; the reader offers one question on
 * what you just read — the moment recalling it does the most good. It is an
 * offer, in a corner: "Not now" and it is gone for this idea. Answered, the
 * question is graded the way a rehearsal is (tool questions by computing the
 * answer), and the result lights the idea — on the strip, and on the course
 * map, through the same history a rehearsal writes to.
 */

export interface CheckpointOutcome {
  correct: number;
  total: number;
  results: { page: number; idea: string; kind: string; correct: boolean }[];
}

interface Props {
  /** The idea just finished; null when there is nothing to offer. */
  idea: { name: string; first: number; last: number } | null;
  lectureTitle: string;
  load: () => Promise<Checkpoint>;
  pageHref: (page: number) => string;
  onDone: (outcome: CheckpointOutcome) => void;
  /** Told when the question panel opens and closes — the reader must not go quiet under it. */
  onOpenChange?: (open: boolean) => void;
  /** The other way to check: explain the idea in your own words. */
  onTeach?: () => void;
  /** The quiet check-in: how the idea landed, before any question. Optional, never blocking. */
  onCheckIn?: (rating: 'got_it' | 'confused') => void;
  /** Every answer, as given, with the span the checkpoint was served for, so the server can grade it too. */
  onAnswer?: (questionId: number, answer: Answer, span: { first: number; last: number }) => void;
  onDismiss: () => void;
}

type Phase = 'offer' | 'loading' | 'asking' | 'done' | 'failed';

export function CheckpointCard({ idea, lectureTitle, load, pageHref, onDone, onOpenChange, onTeach, onCheckIn, onAnswer, onDismiss }: Props) {
  const { t } = useTranslation('v4Reader');
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('offer');
  const [cp, setCp] = useState<Checkpoint | null>(null);
  const [at, setAt] = useState(0);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [rating, setRating] = useState<'got_it' | 'confused' | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const ideaKey = idea ? `${idea.first}-${idea.last}` : '';

  /* A new idea finished: start again from the offer. */
  useEffect(() => {
    setPhase('offer');
    setCp(null);
    setAt(0);
    setGrades([]);
    setRating(null);
  }, [ideaKey]);

  useEffect(() => {
    if (phase === 'asking' || phase === 'done') panelRef.current?.focus();
  }, [phase, at]);

  const start = () => {
    setPhase('loading');
    load()
      .then((c) => {
        setCp(c);
        setPhase(c.questions.length ? 'asking' : 'failed');
      })
      .catch(() => setPhase('failed'));
  };

  const finish = (all: Grade[]) => {
    if (!cp) return;
    setPhase('done');
    onDone({
      correct: all.filter((g) => g.correct).length,
      total: all.length,
      results: cp.questions.map((q, i) => ({ page: q.page, idea: idea?.name ?? q.idea, kind: q.kind, correct: Boolean(all[i]?.correct) })),
    });
  };

  const open = phase === 'asking' || phase === 'done';
  useEffect(() => {
    onOpenChange?.(Boolean(idea) && (open || phase === 'loading'));
  }, [idea, open, phase, onOpenChange]);
  const q = cp?.questions[at];
  const correct = grades.filter((g) => g.correct).length;

  return (
    <AnimatePresence>
      {/* Lifted clear of the reader's pager and the Explain ask bar, which sit in the
          bottom ~100px: at bottom-5 the card covered the Next arrow (LS-053). */}
      {idea && !open && (
        <motion.div
          key={`offer-${ideaKey}`}
          role="status"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : 8 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-[max(112px,calc(env(safe-area-inset-bottom)+104px))] left-5 right-5 z-[44] rounded-3xl border border-white/[0.09] bg-[#0b0b0c] p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] sm:left-auto sm:w-80"
        >
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('checkpoint.offer.dismiss')}
            className="console-focusable absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
          <p className="flex items-center gap-1.5 text-[12.5px] text-quiet">
            <Sparkles aria-hidden className="h-3.5 w-3.5" style={{ color: 'var(--reader-accent, hsl(var(--secondary)))' }} />
            {t('checkpoint.offer.finished')}
          </p>
          <p className="mt-1.5 pr-6 text-[15px] leading-[1.4] text-foreground">{idea.name}</p>
          <p className="mt-1 text-[13px] text-quiet">
            {phase === 'failed' ? t('checkpoint.offer.failed') : t('checkpoint.offer.prompt')}
          </p>
          {onCheckIn && phase !== 'failed' && (
            <div role="group" aria-label={t('checkpoint.checkin.label')} className="mt-3 flex flex-wrap gap-1.5">
              {(['got_it', 'confused'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={rating === r}
                  onClick={() => {
                    /* A repeat tap on the chosen one says nothing new; switching still does. */
                    if (rating === r) return;
                    setRating(r);
                    onCheckIn(r);
                  }}
                  className={cn(
                    'console-focusable inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] transition-colors',
                    rating === r ? 'bg-white/[0.16] text-foreground' : 'bg-white/[0.05] text-quiet hover:bg-white/[0.1] hover:text-foreground',
                  )}
                >
                  {t(r === 'got_it' ? 'checkpoint.checkin.clicked' : 'checkpoint.checkin.foggy')}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={start}
            disabled={phase === 'loading'}
            className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-background transition-colors disabled:bg-white/[0.12] disabled:text-quiet"
          >
            {phase === 'loading' ? t('checkpoint.offer.loading') : phase === 'failed' ? t('checkpoint.offer.retry') : t('checkpoint.offer.start')}
            {phase === 'offer' && <ArrowRight aria-hidden className="h-3.5 w-3.5" />}
          </button>
          {onTeach && phase !== 'loading' && (
            <button
              type="button"
              onClick={onTeach}
              className="console-focusable inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.08] px-4 text-[13px] text-foreground transition-colors hover:bg-white/[0.14]"
            >
              <PenLine aria-hidden className="h-3.5 w-3.5" />
              {t('checkpoint.offer.teach')}
            </button>
          )}
          </div>
        </motion.div>
      )}

      {idea && open && cp && (
        <motion.div
          key={`panel-${ideaKey}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[50] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('checkpoint.panel.label', { name: idea.name })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onDismiss();
              /* Arrows answer the question here; they must not turn pages behind it. */
              e.stopPropagation();
            }}
            initial={reduce ? false : { y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/[0.09] bg-[#0b0b0c] p-6 outline-none sm:p-8"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <p className="text-[13px] tabular-nums text-quiet">
                {t('checkpoint.panel.heading', { first: idea.first, last: idea.last })}
                {phase === 'asking' && cp.questions.length > 1 && (
                  <span className="text-faint">
                    {' '}
                    · {t('checkpoint.panel.progress', { n: at + 1, total: cp.questions.length })}
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t('checkpoint.panel.close')}
                className="console-focusable flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>

            {phase === 'asking' && q && (
              <>
                <QuestionView
                  key={q.id}
                  q={q}
                  lectureTitle={lectureTitle}
                  pageHref={pageHref(q.page)}
                  graded={grades[at] ?? null}
                  onCheck={(a) => {
                    setGrades((g) => [...g.slice(0, at), grade(q, a)]);
                    if (cp) onAnswer?.(q.id, a, { first: cp.first, last: cp.last });
                  }}
                />
                {grades[at] && (
                  <button
                    type="button"
                    onClick={() => (at + 1 < cp.questions.length ? setAt(at + 1) : finish(grades))}
                    className="console-focusable mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-medium text-background transition-colors"
                  >
                    {at + 1 < cp.questions.length ? t('checkpoint.panel.next') : t('checkpoint.panel.finish')}
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </>
            )}

            {phase === 'done' && (
              <div className="py-6 text-center">
                <motion.span
                  initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'mx-auto flex h-14 w-14 items-center justify-center rounded-full',
                    correct === grades.length ? 'bg-success/[0.14] text-success' : 'bg-white/[0.07] text-foreground',
                  )}
                >
                  {correct === grades.length ? <Check aria-hidden className="h-6 w-6" /> : <span className="text-[17px] tabular-nums">{correct}/{grades.length}</span>}
                </motion.span>
                <p className="mt-4 text-[19px] font-medium text-foreground">
                  {correct === grades.length ? t('checkpoint.done.lit', { name: idea.name }) : t('checkpoint.done.revisit', { name: idea.name })}
                </p>
                <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-[1.5] text-quiet">
                  {correct === grades.length
                    ? t('checkpoint.done.litNote')
                    : t('checkpoint.done.revisitNote')}
                </p>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="console-focusable mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-medium text-background transition-colors"
                >
                  {t('checkpoint.done.keepReading')}
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
