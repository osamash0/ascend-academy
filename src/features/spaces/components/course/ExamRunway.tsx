import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { ExamPlan, PlanDay } from './examPlan';
import type { TodayStep } from './today';
import { say } from './phrase';
import { formatDate } from '../../i18n/format';

/**
 * The days to the exam, as a runway.
 *
 * One column per day, its height the day's work, its marks the kinds of work
 * in it — reading white, a miss to revisit red, a fading idea green, a
 * rehearsal an outlined ring. Today is lit; the exam stands at the end. The
 * plan's shape is visible at a glance — the reading front-loaded, the review
 * after, the full rehearsal two days out, the light last day — and any day
 * opens to say what is in it.
 */

const MARK: Record<TodayStep['kind'], string> = {
  read: 'bg-white/[0.28]',
  revisit: 'bg-destructive',
  refresh: 'bg-success',
  rehearse: 'border border-white/[0.85] bg-transparent',
};

interface Props {
  plan: ExamPlan;
  examDate: string;
  hrefFor: (step: TodayStep) => string;
}

export function ExamRunway({ plan, examDate, hrefFor }: Props) {
  const { t } = useTranslation('v4Space');
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<number | null>(null);
  const most = Math.max(30, ...plan.days.map((d) => d.minutes));
  const day: PlanDay | undefined = open !== null ? plan.days[open] : undefined;

  return (
    <div className="mt-5">
      <ol aria-label={t('runway.label')} className="flex h-24 items-end gap-[3px]">
        {plan.days.map((d, i) => (
          <li key={d.date} className="flex h-full min-w-[4px] flex-1 flex-col justify-end">
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-pressed={open === i}
              aria-label={t('runway.day', {
                day: i === 0 ? t('runway.today') : formatDate(d.date, 'long'),
                steps: d.steps.map((s) => say(t, s.title)).join(', ') || t('runway.rest'),
              })}
              className={cn(
                'console-focusable group flex h-full w-full flex-col justify-end rounded-sm transition-colors',
                open === i ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
              )}
            >
              <motion.span
                className="flex w-full flex-col-reverse gap-[2px] overflow-hidden rounded-[2px]"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: reduce ? 0 : Math.min(0.6, i * 0.012) }}
                style={{ height: `${Math.max(10, (d.minutes / most) * 100)}%` }}
              >
                {d.steps.map((s, k) => (
                  <span key={k} className={cn('min-h-[3px] w-full rounded-[1px]', MARK[s.kind])} style={{ flexGrow: s.minutes }} />
                ))}
              </motion.span>
              <span
                aria-hidden
                className={cn('mt-1.5 block h-[3px] w-full rounded-full', i === 0 ? 'bg-[color:var(--stage-accent,theme(colors.white))]' : 'bg-white/[0.1]')}
              />
            </button>
          </li>
        ))}
        {/* The exam itself, at the end of the runway. */}
        <li aria-hidden className="flex h-full flex-col items-center justify-end pl-1.5">
          <span className="mb-1 text-[11px] text-quiet">{t('runway.exam')}</span>
          <span className="block h-16 w-[2px] rounded-full bg-white" />
          <span className="mt-1.5 block h-[3px] w-2 rounded-full bg-white" />
        </li>
      </ol>
      <div className="mt-2 flex justify-between text-[12px] tabular-nums text-faint">
        <span>{t('runway.today')}</span>
        <span>{formatDate(examDate, 'short')}</span>
      </div>

      <AnimatePresence initial={false}>
        {day && (
          <motion.div
            key={day.date}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4 rounded-2xl border border-white/[0.08] bg-[#0b0b0c] p-4"
          >
            <p className="text-[13px] text-quiet">
              {day.offset === 0 ? t('runway.today') : day.offset === 1 ? t('runway.tomorrow') : formatDate(day.date, 'long')}
              {day.minutes > 0 && <span className="text-faint"> · {t('runway.about', { count: day.minutes })}</span>}
            </p>
            {day.steps.length === 0 ? (
              <p className="mt-2 text-[14px] text-foreground">{t('runway.free')}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {day.steps.map((s, k) => (
                  <li key={k}>
                    <Link
                      to={hrefFor(s)}
                      className="console-focusable group flex items-baseline gap-3 rounded-lg py-1 text-[14px] transition-colors"
                    >
                      <span aria-hidden className={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', MARK[s.kind])} />
                      <span className="text-foreground group-hover:underline group-hover:decoration-white/30 group-hover:underline-offset-4">{say(t, s.title)}</span>
                      <span className="min-w-0 truncate text-[13px] text-quiet">{say(t, s.why)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
