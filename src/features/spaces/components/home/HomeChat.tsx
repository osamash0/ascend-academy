/**
 * Home's Luna thread — what Home becomes after you ask (LS-127, LS-128).
 *
 * The session itself is the reader's: `useLunaSession`, the same API, the
 * same blocks through the same `BlockView`. What is Home's is the room: the
 * thread reads down from Luna, follows her words as they arrive and lets go
 * the moment you scroll up to re-read; the page she is on stands on the right
 * with the words she lit, and a trail of the pages she has been to; the plan
 * sits above as one quiet strip; a check is graded here and reported there.
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
import type { LunaCheck, LunaMove } from '../../data/lunaSession';
import type { useLunaSession } from '../../data/useLunaSession';
import { BlockView } from '../reader/iui/Blocks';
import { PlanStrip } from '../reader/luna/PlanStrip';
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
 * A check you commit to. Which option is right is data the tutor wrote; the
 * grading, the hint on a first miss and the reason on success are this card's.
 * The first committed answer is what the session records.
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
    <motion.div {...ARRIVE} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
      <p className="text-[12px] text-quiet">{t('check.label')}</p>
      <p className="mt-1 text-[15.5px] font-medium leading-[1.5]">{check.question}</p>
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
        <button
          type="button"
          onClick={commit}
          disabled={picked === null}
          className="console-focusable mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900 disabled:opacity-30"
        >
          {result === 'wrong' ? t('homeChat.tryAgain') : t('homeChat.check')}
        </button>
      )}
    </motion.div>
  );
}

/** The thread: Luna's plan, her words and blocks, your questions, the way forward. */
export function HomeChat({ luna, lesson, accent, onSpot }: { luna: Luna; lesson: HomeLesson; accent: string; onSpot: (m: LunaMove) => void }) {
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
      {state.plan.length > 0 && (
        <div className="mb-5 md:pl-[4.75rem]">
          <PlanStrip plan={state.plan} accepted={accepted} onAccept={() => void luna.act('accept_plan')} onSkip={() => void luna.act('skip_step')} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto pr-2 [scrollbar-width:thin]">
          <ol className="space-y-8 pb-3 md:pl-[4.75rem]" ref={contentRef}>
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
                  <button type="button" onClick={() => void luna.act('continue')} className="console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900">
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
 * The page Luna is on, and the trail of pages she has been to. The reader
 * draws pages; here the page is named and the words she lit are quoted, and
 * the card is the door into the reader at that page with the same words lit.
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
                className="console-focusable flex h-full w-full flex-col justify-between rounded-xl border border-white/[0.10] bg-white/[0.03] px-6 py-5"
                style={{ boxShadow: `0 0 0 2px ${accent}` }}
              >
                <span className="flex items-start justify-between">
                  <span className="text-[12.5px] text-quiet">{t('homeChat.page')}</span>
                  <ArrowUpRight aria-hidden className="h-4 w-4 text-quiet" />
                </span>
                <span className="text-[44px] font-medium leading-none tabular-nums tracking-[-0.03em]">{spot.page}</span>
                {spot.spot ? (
                  <span className="mt-3 line-clamp-2 text-[13.5px] leading-[1.5]">
                    <span className="rounded px-1 box-decoration-clone" style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)` }}>{spot.spot}</span>
                  </span>
                ) : (
                  <span className="mt-3 text-[13px] text-quiet">{lesson.title}</span>
                )}
              </Link>
            </motion.div>
          ) : (
            <motion.div
              key="cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              className="absolute inset-0 flex flex-col justify-end overflow-hidden rounded-xl border border-white/[0.08] px-6 py-5"
              style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 16%, transparent), transparent 70%)` }}
            >
              <span className="text-[22px] font-medium tracking-[-0.02em]">{lesson.title}</span>
              <motion.span
                className="mt-3 text-[12.5px] text-quiet"
                animate={reading ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.7 }}
                transition={reading ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
              >
                {reading ? t('homeChat.reading') : t('homeChat.askAbout')}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2.5 flex items-baseline justify-end text-[12.5px]">
        <AnimatePresence>
          {spot && (
            <motion.span key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Link to={pagePath(lesson.spaceId, spot)} className="console-focusable rounded text-foreground underline-offset-4 hover:underline">
                {t('homeChat.openPage')}
              </Link>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {pages.length > 0 && (
        <div className="relative mt-5">
          {pages.length > 1 && <span aria-hidden className="pointer-events-none absolute left-2 right-2 top-1/2 h-px bg-white/[0.10]" />}
          <ul className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <AnimatePresence initial={false}>
              {pages.map((n) => (
                <motion.li key={n} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="list-none">
                  <button
                    type="button"
                    onClick={() => onSpot({ lecture_id: lesson.id, page: n })}
                    aria-label={t('homeChat.showPage', { page: n })}
                    aria-pressed={spot?.page === n}
                    className="console-focusable flex aspect-[16/10] w-[4.25rem] items-center justify-center rounded-md bg-white/[0.04] text-[12px] tabular-nums"
                    style={{ boxShadow: spot?.page === n ? `0 0 0 2px ${accent}` : '0 0 0 1px rgba(255,255,255,0.10)' }}
                  >
                    {n}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </aside>
  );
}
