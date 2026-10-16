import { motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { journeyOf, type JourneyStep, type ShelfItem, type StepState } from '../studio/shelf';
import { FLIGHT_EASE } from '../studio/motion';

/**
 * Where a page stands (One Library spec §5.5): Brought in · Understood ·
 * Shared · Landed, as a quiet row of rings under the page's header. Done is a
 * teal ring with a check, now is a white ring, the rest are faint. The line
 * between two steps fills from the left once the step after it is done.
 */

const STEPS: { key: JourneyStep; label: string }[] = [
  { key: 'brought', label: 'Brought in' },
  { key: 'understood', label: 'Understood' },
  { key: 'shared', label: 'Shared' },
  { key: 'landed', label: 'Landed' },
];

const SAID: Record<StepState, string> = { done: 'done', now: 'now', todo: 'not yet' };

const LINK_S = 0.7;

export function Journey({ item, className }: { item: ShelfItem; className?: string }) {
  const reduce = useReducedMotion();
  const states = journeyOf(item);
  return (
    <ol aria-label="Where this page is" className={cn('flex items-center', className)}>
      {STEPS.map((s, i) => {
        const state = states[s.key];
        const next = STEPS[i + 1];
        const filled = next ? states[next.key] === 'done' : false;
        return (
          <li
            key={s.key}
            data-state={state}
            className={cn(
              'flex items-center gap-2 text-[12.5px]',
              next && 'flex-1',
              state === 'todo' ? 'text-faint' : 'text-foreground',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] tabular-nums transition-colors',
                state === 'done' &&
                  'border-[rgb(var(--studio-woven))] bg-[rgb(var(--studio-woven)/0.12)] text-[rgb(var(--studio-woven))]',
                state === 'now' && 'border-foreground',
                state === 'todo' && 'border-current',
              )}
            >
              {state === 'done' ? <Check className="h-3 w-3" strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="whitespace-nowrap">
              <span>{s.label}</span>
              <span className="sr-only">, {SAID[state]}</span>
            </span>
            {next && (
              <span aria-hidden className="relative mx-2.5 h-[1.5px] min-w-[30px] flex-1 overflow-hidden bg-[rgb(var(--studio-hairline))]">
                <motion.span
                  className="absolute inset-0 origin-left bg-[rgb(var(--studio-woven))]"
                  initial={reduce ? { scaleX: filled ? 1 : 0, opacity: 0 } : { scaleX: 0 }}
                  animate={reduce ? { scaleX: filled ? 1 : 0, opacity: 1 } : { scaleX: filled ? 1 : 0 }}
                  transition={{ duration: reduce ? 0.15 : LINK_S, ease: FLIGHT_EASE }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
