import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, BookOpen, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { RehearsalQuestion } from '../../data/liveRepository';
import { fdText } from '../reader/iui/fd';
import { Inline } from '../reader/iui/Blocks';
import type { Answer, Grade } from './grade';

/**
 * One rehearsal question, answered and then checked.
 *
 * Each kind gets the control that fits it: options to choose, items to put
 * in order, FDs to tick against a table, attributes to collect for a
 * closure, FDs to flag for BCNF. "Check" commits the answer; after it the
 * question shows what was right, why, and the page that teaches it.
 */

interface Props {
  q: RehearsalQuestion;
  lectureTitle: string;
  pageHref: string;
  graded: Grade | null;
  onCheck: (a: Answer) => void;
}

const option = (on: boolean, locked: boolean) =>
  cn(
    'console-focusable flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[15px] transition-colors',
    on ? 'border-white/[0.5] bg-white/[0.08] text-foreground' : 'border-white/[0.09] text-foreground',
    !locked && !on && 'hover:bg-white/[0.04]',
  );

export function QuestionView({ q, lectureTitle, pageHref, graded, onCheck }: Props) {
  const { t } = useTranslation('v4Space');
  const locked = graded !== null;
  const [choice, setChoice] = useState<number | null>(null);
  /* Never open on the answer: an order that arrives already solved is turned by one. */
  const [order, setOrder] = useState<number[]>(() => {
    if (q.kind !== 'order') return [];
    const s = q.shuffle.length === q.items.length ? q.shuffle : q.items.map((_, i) => i);
    return s.every((v, i) => v === i) && s.length > 1 ? [...s.slice(1), s[0]] : s;
  });
  const [ticked, setTicked] = useState<number[]>([]);
  const [attrs, setAttrs] = useState<string[]>(() => (q.kind === 'closure' ? [...q.start] : []));

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const move = (i: number, by: number) =>
    setOrder((o) => {
      const j = i + by;
      if (j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const answer = (): Answer | null => {
    switch (q.kind) {
      case 'choice':
        return choice === null ? null : { kind: 'choice', index: choice };
      case 'order':
        return { kind: 'order', order };
      case 'fdHolds':
        return { kind: 'fdHolds', holds: ticked };
      case 'closure':
        return { kind: 'closure', attrs };
      case 'bcnf':
        return { kind: 'bcnf', violating: ticked };
    }
  };
  const ready = answer() !== null;

  return (
    <div>
      <p className="mb-3 text-[13px] text-quiet">
        {lectureTitle}
        <span aria-hidden className="mx-2 text-faint">·</span>
        {q.idea}
      </p>
      <h2 className="mb-7 text-[24px] font-medium leading-[1.3] tracking-[-0.015em] text-foreground sm:text-[28px]">
        <Inline text={q.prompt} />
      </h2>

      {q.kind === 'choice' && (
        <div className="space-y-2">
          {q.options.map((o, i) => {
            const right = locked && o.correct;
            const wrong = locked && choice === i && !o.correct;
            return (
              <button
                key={o.text}
                type="button"
                disabled={locked}
                aria-pressed={choice === i}
                onClick={() => setChoice(i)}
                className={cn(option(choice === i, locked), right && 'border-success/60 bg-success/10', wrong && 'border-destructive/60 bg-destructive/10')}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[12px] tabular-nums text-quiet">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">
                  <Inline text={o.text} />
                </span>
                {right && <Check aria-hidden className="h-4 w-4 text-success" />}
                {wrong && <X aria-hidden className="h-4 w-4 text-destructive" />}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === 'order' && (
        <ol className="space-y-2">
          {order.map((orig, i) => (
            <motion.li
              key={orig}
              layout
              transition={{ duration: 0.2 }}
              className={cn(
                'flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-[15px]',
                locked ? (orig === i ? 'border-success/50 bg-success/10' : 'border-destructive/50 bg-destructive/10') : 'border-white/[0.09]',
              )}
            >
              <span className="w-5 text-[13px] tabular-nums text-quiet">{i + 1}</span>
              <span className="flex-1 text-foreground">{q.items[orig]}</span>
              {!locked && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    aria-label={t('question.moveUp', { item: q.items[orig] })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="console-focusable flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-25"
                  >
                    <ArrowUp aria-hidden className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('question.moveDown', { item: q.items[orig] })}
                    disabled={i === order.length - 1}
                    onClick={() => move(i, 1)}
                    className="console-focusable flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-25"
                  >
                    <ArrowDown aria-hidden className="h-4 w-4" />
                  </button>
                </span>
              )}
            </motion.li>
          ))}
        </ol>
      )}

      {q.kind === 'fdHolds' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  {q.columns.map((c) => (
                    <th key={c} className="border-b border-white/[0.08] px-4 py-2.5 text-left font-medium text-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((v, ci) => (
                      <td key={ci} className="border-b border-white/[0.05] px-4 py-2 text-quiet">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-quiet">{t('question.fdHoldsHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.candidates.map((fd, i) => (
              <button
                key={fdText(fd)}
                type="button"
                disabled={locked}
                aria-pressed={ticked.includes(i)}
                onClick={() => setTicked((t) => toggle(t, i))}
                className={cn(option(ticked.includes(i), locked), 'font-mono text-[14px]')}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                    ticked.includes(i) ? 'border-transparent bg-white text-background' : 'border-white/[0.25]',
                  )}
                >
                  {ticked.includes(i) && <Check aria-hidden className="h-3.5 w-3.5" />}
                </span>
                {fdText(fd)}
              </button>
            ))}
          </div>
        </div>
      )}

      {q.kind === 'closure' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {q.fds.map((fd) => (
              <span key={fdText(fd)} className="rounded-xl bg-white/[0.05] px-3 py-1.5 font-mono text-[14px] text-quiet">
                {fdText(fd)}
              </span>
            ))}
          </div>
          <p className="text-[13px] text-quiet">{t('question.closureHint', { set: `{${q.start.join(', ')}}` })}</p>
          <div className="flex flex-wrap gap-2">
            {q.attrs.map((a) => {
              const on = attrs.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  disabled={locked || q.start.includes(a)}
                  aria-pressed={on}
                  onClick={() => setAttrs((x) => toggle(x, a))}
                  className={cn(
                    'console-focusable h-12 min-w-12 rounded-xl px-3 font-mono text-[16px] transition-colors',
                    on ? 'bg-white text-background' : 'border border-dashed border-white/[0.2] text-quiet hover:bg-white/[0.05]',
                  )}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {q.kind === 'bcnf' && (
        <div className="space-y-4">
          <p className="font-mono text-[15px] text-foreground">
            {q.relation}({q.attrs.join(', ')})
          </p>
          <p className="text-[13px] text-quiet">{t('question.bcnfHint', { relation: q.relation })}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.fds.map((fd, i) => (
              <button
                key={fdText(fd)}
                type="button"
                disabled={locked}
                aria-pressed={ticked.includes(i)}
                onClick={() => setTicked((t) => toggle(t, i))}
                className={cn(option(ticked.includes(i), locked), 'font-mono text-[14px]')}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                    ticked.includes(i) ? 'border-transparent bg-destructive text-background' : 'border-white/[0.25]',
                  )}
                >
                  {ticked.includes(i) && <X aria-hidden className="h-3.5 w-3.5" />}
                </span>
                {fdText(fd)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Check, then the verdict and the page that teaches it. */}
      {!locked ? (
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            const a = answer();
            if (a) onCheck(a);
          }}
          className="console-focusable mt-8 h-12 rounded-full bg-white px-8 text-[15px] font-medium text-background transition-colors disabled:bg-white/[0.12] disabled:text-faint"
        >
          {t('question.check')}
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={cn('mt-8 rounded-2xl border p-5', graded.correct ? 'border-success/40 bg-success/[0.06]' : 'border-destructive/40 bg-destructive/[0.06]')}
        >
          <p className={cn('mb-1.5 flex items-center gap-2 text-[15px] font-medium', graded.correct ? 'text-success' : 'text-destructive')}>
            {graded.correct ? <Check aria-hidden className="h-4 w-4" /> : <X aria-hidden className="h-4 w-4" />}
            {graded.correct ? t('question.right') : t('question.notQuite')}
          </p>
          {!graded.correct && <p className="mb-2 font-mono text-[13.5px] text-foreground">{graded.expected}</p>}
          {q.why && (
            <p className="text-[14px] leading-[1.55] text-quiet">
              <Inline text={q.why} />
            </p>
          )}
          <Link
            to={pageHref}
            className="console-focusable mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.07] px-4 text-[13px] text-foreground transition-colors hover:bg-white/[0.12]"
          >
            <BookOpen aria-hidden className="h-3.5 w-3.5" />
            {t('question.page', { lesson: lectureTitle, page: q.page })}
          </Link>
        </motion.div>
      )}
    </div>
  );
}
