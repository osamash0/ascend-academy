import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ghostPillSm, whitePillSm } from '../components/stage';
import { ShowMore } from './ShowMore';
import { useStepped } from './stepped';
import type { LandingLesson, LandingQuestion } from './types';

/**
 * Questions for you.
 *
 * A person is waiting, so the waiting ones come before the map. Each is the
 * question as it was sent, who sent it (or "Someone", when they chose to
 * send it without a name), when, and the page it came from, as a way into
 * the reader. Where answering is possible, it happens in the row: write, then choose whether it
 * goes to them alone or lands on that page for every member. An answered
 * question leaves the list for the Answered fold at the foot of the door.
 *
 * The longest-waiting come first, three of them; the rest open ten at a time.
 *
 * A hairline list, not cards: the rows are the content.
 */

/** "just now", "2 hours ago", "yesterday", "3 days ago". */
function when(t: (k: string, v?: Record<string, number>) => string, iso: string, now = Date.now()): string {
  const hours = Math.floor((now - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return t('questions.when.now');
  if (hours < 24) return t('questions.when.hours', { count: hours });
  return t('questions.when.days', { count: Math.floor(hours / 24) });
}

/** How many rows a list opens on, and how many each Show more adds. */
const FIRST = 3;
const STEP = 10;

const longestWaiting = (a: LandingQuestion, b: LandingQuestion) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
const lastAnswered = (a: LandingQuestion, b: LandingQuestion) => Date.parse(b.answer?.at ?? b.createdAt) - Date.parse(a.answer?.at ?? a.createdAt);

interface RowsProps {
  questions: LandingQuestion[];
  lessons: Map<string, LandingLesson>;
  spaceId: string;
  accent: string;
}

/** The questions still waiting for an answer. Without `onAnswer` (live, until the Questions channel ships its composer) they are read, never offered an answer that goes nowhere. */
export function QuestionsRow({
  onAnswer,
  ...props
}: RowsProps & { onAnswer?: (questionId: string, text: string, forEveryone: boolean) => void }) {
  const { t } = useTranslation('v4Landing');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const ordered = [...props.questions].sort(longestWaiting);
  const step = useStepped(ordered.length, FIRST, STEP);

  const send = (q: LandingQuestion, forEveryone: boolean) => {
    const text = draft.trim();
    if (!text || !onAnswer) return;
    onAnswer(q.id, text, forEveryone);
    setOpenId(null);
    setDraft('');
  };

  return (
    <>
    <Rows {...props} questions={ordered.slice(0, step.shown)}>
      {(q) =>
        !onAnswer ? null : openId === q.id ? (
          <div className="mt-4">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('questions.placeholder')}
              aria-label={t('questions.placeholder')}
              rows={3}
              className="console-focusable w-full resize-none rounded-xl border border-white/[0.1] bg-black/40 px-4 py-3 text-[15px] leading-relaxed placeholder:text-quiet/70"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => send(q, true)} disabled={!draft.trim()} className={whitePillSm}>
                {t('questions.everyone')}
              </button>
              <button type="button" onClick={() => send(q, false)} disabled={!draft.trim()} className={ghostPillSm}>
                {t('questions.them')}
              </button>
              <span className="text-[12.5px] text-quiet">{t('questions.everyoneHint')}</span>
              <button type="button" onClick={() => setOpenId(null)} className="console-focusable ml-auto rounded-full px-3 py-1.5 text-[13px] text-quiet hover:text-foreground">
                {t('questions.close')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <button type="button" onClick={() => { setOpenId(q.id); setDraft(''); }} className={ghostPillSm}>
              {t('questions.answer')}
            </button>
          </div>
        )
      }
    </Rows>
    <ShowMore more={step.more} less={step.less} className="mt-4" />
    </>
  );
}

/** The answered ones, folded into one line at the foot of the door; it opens in place. */
export function AnsweredFold(props: RowsProps) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const ordered = [...props.questions].sort(lastAnswered);
  const step = useStepped(ordered.length, FIRST, STEP);

  return (
    <section className="mt-16">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="console-focusable -mx-2 flex items-center gap-2 rounded-lg px-2 py-1 text-[15px] text-quiet transition-colors hover:text-foreground"
      >
        {t('questions.fold')}
        <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4"
          >
            <Rows {...props} questions={ordered.slice(0, step.shown)}>
              {(q) =>
                q.answer && (
                  <div className="mt-4 border-l-2 pl-4" style={{ borderColor: `color-mix(in srgb, ${props.accent} 60%, transparent)` }}>
                    <p className="flex items-center gap-1.5 text-[12.5px] text-quiet">
                      <Check aria-hidden className="h-3.5 w-3.5" />
                      {q.answer.forEveryone ? t('questions.answered.everyone') : t('questions.answered.them')}
                    </p>
                    <p className="mt-1.5 text-[15px] leading-relaxed">{q.answer.text}</p>
                  </div>
                )
              }
            </Rows>
            <ShowMore more={step.more} less={step.less} className="mt-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** One hairline row per question, in the order given: face, who and when, the page on the right, the question, then what follows. */
function Rows({ questions, lessons, spaceId, children }: RowsProps & { children: (q: LandingQuestion) => ReactNode }) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();

  return (
    <ol className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
      {questions.map((q) => {
        const lesson = lessons.get(q.lessonId);
        return (
          <motion.li key={q.id} layout={!reduce} className="flex items-start gap-4 py-5">
            {/* A name, never a face: the asker chose to be named, not to be shown. */}
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.18] text-[12px] text-quiet">
              {q.asker?.name.trim().charAt(0).toLocaleUpperCase() || '?'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="text-[13px]">
                  <span className="text-foreground">{q.asker?.name ?? t('questions.someone')}</span>
                  <span className="ml-2 text-quiet">{when(t, q.createdAt)}</span>
                </p>
                <Link
                  to={`/v4/space/${spaceId}/lesson/${q.lessonId}/faces?page=${q.page}`}
                  className="console-focusable rounded-sm text-[13px] text-quiet hover:text-foreground hover:underline hover:decoration-white/30 hover:underline-offset-4"
                >
                  {t('questions.where', { lesson: lesson?.title ?? '', page: q.page })}
                </Link>
              </div>
              <p className="mt-1.5 text-[16px] leading-relaxed">{q.text}</p>
              {children(q)}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
