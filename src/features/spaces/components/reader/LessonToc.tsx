import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { timing } from './Planes';
import type { ReadingSection } from './anchors';

/**
 * The Lesson's contents, down the left edge.
 *
 * Every Concept, in reading order; the one you are in is white and opens to
 * show its pages, the page in view lit. An index you can press, not a
 * progress bar — moving through the Lesson is turning pages.
 */

interface Props {
  sections: ReadingSection[];
  conceptId: string;
  page: number;
  onPage: (page: number) => void;
}

export function LessonToc({ sections, conceptId, page, onPage }: Props) {
  return (
    <nav aria-label="Contents of this Lesson" className="w-full">
      <ol className="space-y-1">
        {sections.map((s) => {
          const current = s.conceptId === conceptId;
          return (
            <li key={s.conceptId}>
              <button
                type="button"
                onClick={() => onPage(s.firstPage)}
                aria-current={current ? 'location' : undefined}
                className={cn(
                  'console-focusable w-full rounded-md py-1.5 text-left text-[13px] leading-[1.35] transition-colors',
                  current ? 'font-medium text-foreground' : 'text-faint hover:text-quiet',
                )}
              >
                {s.name}
              </button>
              {current && (
                <motion.ol
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: timing.card }}
                  className="mb-2 max-h-[42vh] space-y-0.5 overflow-y-auto pl-3"
                >
                  {s.blocks.map((b) => {
                    const here = b.page === page;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => onPage(b.page)}
                          aria-current={here ? 'page' : undefined}
                          className={cn(
                            'console-focusable flex w-full items-baseline gap-2 rounded-md py-1 text-left text-[12.5px] leading-[1.35] transition-colors',
                            here ? 'text-foreground' : 'text-faint hover:text-quiet',
                          )}
                        >
                          <span className="w-5 shrink-0 tabular-nums">{b.page}</span>
                          <span className="line-clamp-2">{b.title ?? `Page ${b.page}`}</span>
                        </button>
                      </li>
                    );
                  })}
                </motion.ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
