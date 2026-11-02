/**
 * Home's Luna thread — what Home becomes after you ask (LS-127, LS-128).
 *
 * The session itself is the reader's: `useLunaSession`, the same API, the
 * same blocks through the same `BlockView`. What is Home's is the room, and
 * the room is kept quiet on purpose. One line says where you are in the plan.
 * The thread reads down from Luna, follows her words as they arrive and lets
 * go the moment you scroll up to re-read. The page she is on sits beside it
 * as a quiet card with the words she lit. A check is graded here and
 * reported there. One white pill at a time says what comes next.
 *
 * Luna's words arrive one at a time — a short fade and a lift, opacity and
 * transform only — so an answer reads as being said rather than pasted.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { cn } from '@/lib/utils';
import type { LunaCheck, LunaMove, PlanStep } from '../../data/lunaSession';
import type { useLunaSession } from '../../data/useLunaSession';
import { BlockView } from '../reader/iui/Blocks';
import { ghostPillSm } from '../stage';

type Luna = ReturnType<typeof useLunaSession>;

export interface HomeLesson {
  id: string;
  title: string;
  spaceId: string;
}

const EASE = [0.2, 0, 0, 1] as const;
const ARRIVE = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: EASE },
} as const;
const whitePill = 'console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900';

/** The reader, at the page Luna went to, with the same words lit. */
const pagePath = (spaceId: string, m: LunaMove) =>
  `/v4/space/${spaceId}/lesson/${m.lecture_id}/faces?page=${m.page}${m.spot ? `&spot=${encodeURIComponent(m.spot)}` : ''}&luna=1`;

/** Words arriving one by one. The markup is the tutor's: `**bold**`, `*emphasis*`. */
function Arriving({ text }: { text: string }) {
  const toks = text.split(/(\s+)/);
  let em = false;
  return (
    <>
      {toks.map((tok, i) => {
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const strong = tok.startsWith('**') && tok.endsWith('**') && tok.length > 4;
        let word = strong ? tok.slice(2, -2) : tok;
        let opens = false;
        let closes = false;
        if (!strong) {
          const m = /^\*(.*?)(\*?)([.,;:!?]*)$/.exec(word);
          if (m && word.startsWith('*')) {
            opens = true;
            closes = m[2] === '*';
            word = m[1] + m[3];
          } else if (/\*[.,;:!?]*$/.test(word) && em) {
            closes = true;
            word = word.replace(/\*([.,;:!?]*)$/, '$1');
          }
        }
        const italic = em || opens;
        if (opens) em = !closes;
        else if (closes) em = false;
        return (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className={cn('inline-block', strong && 'font-semibold', italic && 'italic')}
          >
            {word}
          </motion.span>
        );
      })}
    </>
  );
}

/**
 * Where you are in the plan, said once: before it is accepted, the steps in a
 * sentence and one pill to begin; after, "Step 2 of 4 · its title" with a
 * quiet way to skip. No pills for the steps themselves — four bordered
 * chips above the thread read as four more things to do.
 */
function PlanLine({ plan, accepted, onAccept, onSkip }: { plan: PlanStep[]; accepted: boolean; onAccept: () => void; onSkip: () => void }) {
  const { t } = useTranslation('v4Luna');
  if (!plan.length) return null;
  const open = plan.filter((s) => s.status !== 'skipped');
  const idx = open.findIndex((s) => s.status === 'current');
  if (!accepted) {
    return (
      <div className="flex flex-col gap-3 text-[13px] leading-[1.6] text-quiet">
        <p>
          <span className="text-foreground">{t('homeChat.plan')}</span>
          {' · '}
          {plan.map((s) => s.title).join(' · ')}
        </p>
        <button type="button" onClick={onAccept} className={cn(whitePill, 'self-start')}>
          {t('plan.accept')}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  if (idx < 0) return null;
  return (
    <p className="flex items-baseline gap-3 text-[13px] text-quiet">
      <span className="tabular-nums">{t('homeChat.stepOf', { n: idx + 1, total: open.length })}</span>
      <span className="truncate text-foreground">{open[idx].title}</span>
      <button type="button" onClick={onSkip} className="console-focusable ml-auto shrink-0 rounded hover:text-foreground">
        {t('homeChat.skip')}
      </button>
    </p>
  );
}

/**
 * A check you commit to. Which option is right is data the tutor wrote; the
 * grading, the hint on a first miss and the reason on success are this card's.
 * The first committed answer is what the session records. No label above the
 * question: the options say what it is.
 */
function Check({ check, accent, onCommit }: { check: LunaCheck; accent: string; onCommit: (correct: boolean) => void }) {
  const { t } = useTranslation('v4Luna');
  const [picked, setPicked] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const done = result === 'right';
  const commit = () => {
    if (picked === null) return;
    const ok = check.options[picked].correct;
    setResult(ok ? 'right' : 'wrong');
    if (tries === 0) onCommit(ok);
    setTries((n) => n + 1);
  };
  return (
    <motion.div {...ARRIVE} className="rounded-2xl border border-white/[0.08] px-5 py-4">
      <p className="text-[15.5px] font-medium leading-[1.5]">{check.question}</p>
      <ul className="mt-3 space-y-1">
        {check.options.map((o, i) => {
          const chosen = picked === i;
          return (
            <li key={o.text}>
              <button
                type="button"
                disabled={done}
                onClick={() => {
                  setPicked(i);
                  if (result === 'wrong') setResult(null);
                }}
                aria-pressed={chosen}
                className="console-focusable flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[14.5px] transition-colors hover:bg-white/[0.04] disabled:hover:bg-transparent"
              >
                <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: chosen ? accent : 'rgba(255,255,255,0.25)' }}>
                  {chosen && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
                </span>
                {o.text}
              </button>
            </li>
          );
        })}
      </ul>
      <AnimatePresence mode="wait" initial={false}>
        {result && picked !== null && (
          <motion.p
            key={`${result}-${tries}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-[13.5px] leading-[1.55]"
            style={{ color: result === 'right' ? accent : undefined }}
          >
            {result === 'right' ? check.options[picked].why : tries >= 2 ? check.options[picked].why : t('homeChat.hint')}
          </motion.p>
        )}
      </AnimatePresence>
      {!done && (
        <button type="button" onClick={commit} disabled={picked === null} className={cn(whitePill, 'mt-4 disabled:opacity-30')}>
          {result === 'wrong' ? t('homeChat.tryAgain') : t('homeChat.check')}
        </button>
      )}
    </motion.div>
  );
}

/**
 * The phone's page: one quiet row above the thread, where the card would be
 * on a desk. Only once Luna has been somewhere.
 */
function PageRow({ lesson, accent, spot }: { lesson: HomeLesson; accent: string; spot: LunaMove | null }) {
  const { t } = useTranslation('v4Luna');
  return (
    <AnimatePresence initial={false}>
      {spot && (
        <motion.div key="row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} className="mb-4 md:hidden">
          <Link
            to={pagePath(lesson.spaceId, spot)}
            aria-label={t('homeChat.openPageLabel', { lesson: lesson.title, page: spot.page })}
            className="console-focusable flex items-center gap-3 rounded-xl border border-white/[0.08] px-3 py-2.5"
          >
            <span className="shrink-0 text-[12.5px] tabular-nums text-quiet">{t('homeChat.pageN', { page: spot.page })}</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {spot.spot ? (
                <span className="rounded px-1" style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)` }}>{spot.spot}</span>
              ) : (
                <span className="text-quiet">{lesson.title}</span>
              )}
            </span>
            <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The thread: where you are, Luna's words and blocks, your questions, the one way forward. */
export function HomeChat({
  luna, lesson, accent, spot, onSpot,
}: { luna: Luna; lesson: HomeLesson; accent: string; spot: LunaMove | null; onSpot: (m: LunaMove) => void }) {
  const { t } = useTranslation('v4Luna');
  const { state } = luna;
  const busy = state.busy || state.planning;
  const accepted = state.plan.some((s) => s.status !== 'todo');
  const open = state.plan.some((s) => s.status === 'todo' || s.status === 'current');
  const last = [...state.thread].reverse().find((i) => i.kind === 'luna');
  const checkOpen = last?.kind === 'luna' && Boolean(last.check);
  const canContinue = Boolean(state.sessionId) && accepted && !state.busy && !state.wrap && !state.offerWrap && open && !checkOpen;

  /* Follow the words; let go when you scroll up; snap down on a new turn. */
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ initial: 'instant', resize: 'smooth' });
  const count = state.thread.length;
  const snap = useRef(scrollToBottom);
  snap.current = scrollToBottom;
  useEffect(() => {
    if (count > 0) void snap.current();
  }, [count]);

  return (
    <div className="flex min-h-0 flex-col">
      <PageRow lesson={lesson} accent={accent} spot={spot} />
      {state.plan.length > 0 && !state.wrap && (
        <div className="mb-4 md:pl-[4.75rem]">
          <PlanLine plan={state.plan} accepted={accepted} onAccept={() => void luna.act('accept_plan')} onSkip={() => void luna.act('skip_step')} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto pr-2 [scrollbar-width:thin]">
          <ol className="space-y-7 pb-3 md:pl-[4.75rem]" ref={contentRef}>
            {state.thread.map((item) => {
              if (item.kind === 'learner')
                return (
                  <motion.li key={item.id} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex justify-end">
                    <span className="inline-block max-w-[85%] rounded-2xl bg-white/[0.07] px-4 py-2 text-[14.5px] leading-6">{item.text}</span>
                  </motion.li>
                );
              if (item.kind === 'move')
                return (
                  <motion.li key={item.id} {...ARRIVE}>
                    <button type="button" onClick={() => onSpot(item.move)} className="console-focusable inline-flex items-center gap-1.5 text-[12.5px] text-quiet hover:text-foreground">
                      <ArrowRight aria-hidden className="h-3 w-3" />
                      {t('homeChat.pageN', { page: item.move.page })}
                    </button>
                  </motion.li>
                );
              return (
                <motion.li key={item.id} className="max-w-[60ch] space-y-5">
                  {item.md && (
                    <p className="text-[16px] leading-[1.8] text-foreground">
                      <Arriving text={item.md} />
                    </p>
                  )}
                  {item.blocks.map((b, i) => (
                    <motion.div key={i} {...ARRIVE}>
                      <BlockView block={b} onSpot={() => undefined} onAsk={(q) => void luna.send(q)} />
                    </motion.div>
                  ))}
                  {item.check && <Check check={item.check} accent={accent} onCommit={(ok) => void luna.answerCheck(item.check!.question, ok)} />}
                </motion.li>
              );
            })}
            {busy && (
              <li aria-label={t('homeChat.reading')} className="inline-flex items-center gap-1.5 py-2">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/50" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
                ))}
              </li>
            )}
            {state.error && <li className="text-[13px] text-quiet">{state.error}</li>}
            {(canContinue || (state.offerWrap && !state.wrap)) && (
              <li className="flex flex-wrap gap-2">
                {canContinue && (
                  <button type="button" onClick={() => void luna.act('continue')} className={whitePill}>
                    {t('homeChat.next')}
                    <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
                {state.offerWrap && !state.wrap && (
                  <button type="button" onClick={() => void luna.wrapUp()} className={ghostPillSm}>
                    {t('homeChat.wrapUp')}
                  </button>
                )}
              </li>
            )}
            {state.wrap && (
              <li className="text-[13.5px] text-quiet">
                {t('homeChat.wrapped')}{' '}
                <Link to={`/v4/space/${lesson.spaceId}/lesson/${lesson.id}`} className="console-focusable rounded text-foreground underline-offset-4 hover:underline">
                  {lesson.title}
                </Link>
              </li>
            )}
          </ol>
        </div>
        <AnimatePresence>
          {!isAtBottom && count > 0 && (
            <motion.button
              key="newest"
              type="button"
              onClick={() => void scrollToBottom()}
              initial={{ opacity: 0, y: 6, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 6, x: '-50%' }}
              className={cn(ghostPillSm, 'absolute bottom-3 left-1/2 inline-flex items-center gap-1.5 bg-black')}
            >
              <ArrowDown aria-hidden className="h-3.5 w-3.5" />
              {t('homeChat.newest')}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * The page Luna is on, as a quiet card: the page named small, the words she
 * lit as the content, the whole card the door into the reader. The pages she
 * has been to sit below as plain numbers, only once there are two.
 */
export function HomePage({
  luna, lesson, accent, spot, onSpot,
}: { luna: Luna; lesson: HomeLesson; accent: string; spot: LunaMove | null; onSpot: (m: LunaMove) => void }) {
  const { t } = useTranslation('v4Luna');
  const reading = luna.state.busy || luna.state.planning;
  const pages: number[] = [];
  luna.state.thread.forEach((i) => i.kind === 'move' && !pages.includes(i.move.page) && pages.push(i.move.page));
  return (
    <aside aria-label={t('homeChat.aside')} className="hidden min-h-0 flex-col md:flex">
      <div className="relative aspect-[16/10] w-full">
        <AnimatePresence initial={false}>
          {spot ? (
            <motion.div
              key={`${spot.page}-${spot.spot ?? ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ duration: 0.35, ease: EASE }}
              className="absolute inset-0"
            >
              <Link
                to={pagePath(lesson.spaceId, spot)}
                aria-label={t('homeChat.openPageLabel', { lesson: lesson.title, page: spot.page })}
                className="console-focusable flex h-full w-full flex-col rounded-xl border border-white/[0.10] px-5 py-4 transition-colors hover:border-white/[0.2]"
              >
                <span className="flex items-baseline justify-between text-[12.5px] text-quiet">
                  <span className="tabular-nums">{t('homeChat.pageN', { page: spot.page })}</span>
                  <ArrowUpRight aria-hidden className="h-4 w-4" />
                </span>
                <span className="mt-auto text-[15px] leading-[1.5]">
                  {spot.spot ? (
                    <span className="rounded px-1 box-decoration-clone" style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)` }}>{spot.spot}</span>
                  ) : (
                    <span className="text-quiet">{lesson.title}</span>
                  )}
                </span>
              </Link>
            </motion.div>
          ) : (
            <motion.div
              key="cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              className="absolute inset-0 flex flex-col justify-end rounded-xl border border-white/[0.08] px-5 py-4"
            >
              <span className="text-[17px] font-medium tracking-[-0.01em]">{lesson.title}</span>
              <motion.span
                className="mt-2 text-[12.5px] text-quiet"
                animate={reading ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.7 }}
                transition={reading ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
              >
                {reading ? t('homeChat.reading') : t('homeChat.askAbout')}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {pages.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] tabular-nums">
          {pages.map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => onSpot({ lecture_id: lesson.id, page: n })}
                aria-label={t('homeChat.showPage', { page: n })}
                aria-pressed={spot?.page === n}
                className={cn('console-focusable rounded px-1 transition-colors hover:text-foreground', spot?.page === n ? 'text-foreground' : 'text-quiet')}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
