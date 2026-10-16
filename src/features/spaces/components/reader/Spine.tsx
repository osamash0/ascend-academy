import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Concept } from '../../types';
import { timing } from './Planes';

/**
 * The spine: where you are in the Lesson, as a hairline at the edge.
 *
 * One tick per Concept, in reading order, the current one lit in the Lesson's
 * accent. It replaces a row of step pills that stopped scaling at eight;
 * ticks compress and forty still fit. Resting a pointer on it, or tabbing
 * into it, fans the names out. It is an index — you can press a tick — and
 * it is not the way to move: scrolling is. It is not progress either. Which
 * ideas are cleared is a readout of what the engine already knows, shown as
 * a filled tick; nothing here changes it.
 *
 * Open, the names sit on a pane of their own. They used to fan out straight
 * over the slide, grey on white, and could not be read where they landed.
 */

interface Props {
  concepts: Concept[];
  currentId: string | null;
  onJump: (conceptId: string) => void;
  /** Distance from the right edge, when something is docked there. */
  right?: number;
}

export function Spine({ concepts, currentId, onJump, right = 12 }: Props) {
  const { t } = useTranslation('v4Reader');
  const [open, setOpen] = useState(false);
  if (concepts.length === 0) return null;

  return (
    <nav
      aria-label={t('spine.label')}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      style={{ right }}
      className="fixed top-1/2 z-30 -translate-y-1/2"
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: timing.mark }}
        className="pointer-events-none absolute -inset-y-2 -left-2 -right-2 rounded-2xl border border-white/[0.08] bg-[#0b0b0c]/90 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      />
      <ol className="relative flex flex-col items-end gap-0.5">
        {concepts.map((c) => {
          const current = c.id === currentId;
          return (
            <li key={c.id} className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => onJump(c.id)}
                aria-current={current ? 'location' : undefined}
                aria-label={c.name}
                className={cn(
                  'console-focusable flex h-7 items-center justify-end gap-3 rounded-lg px-2 transition-colors',
                  open && 'hover:bg-white/[0.07]',
                )}
              >
                {/* Only while open: hidden names must not catch the pointer over the slide. */}
                {open && (
                  <motion.span
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: timing.mark }}
                    aria-hidden
                    className={cn(
                      'max-w-[280px] truncate text-[12.5px] tabular-nums',
                      current ? 'text-foreground' : 'text-quiet',
                    )}
                  >
                    {c.name}
                  </motion.span>
                )}
                <span
                  aria-hidden
                  className={cn(
                    'block h-px rounded-full',
                    current
                      ? 'w-5 bg-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))]'
                      : c.progress === 'cleared'
                        ? 'w-3 bg-white/[0.55]'
                        : 'w-3 bg-white/[0.22]',
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
