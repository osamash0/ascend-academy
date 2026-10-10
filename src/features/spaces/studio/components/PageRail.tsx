import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { firstWords } from '../text';
import type { PageGroup } from '../geometry';

interface Props {
  groups: PageGroup[];
  current: number | null;
  onPage(page: number): void;
}

/** A page's name in the rail: its first heading, else its first words. */
function labelFor(g: PageGroup): string {
  if (g.page === 0) return 'Your notes';
  const heading = g.blocks.find((b) => /^#{1,6}\s/.test(b.markdown));
  const text = (heading ?? g.blocks[0])?.markdown ?? '';
  return firstWords(text, 8) || `Page ${g.page}`;
}

/**
 * The Material's contents down the left edge — the reader's contents rail.
 * One entry per page, the page you are on lit. An index you press, not a
 * progress bar.
 */
export function PageRail({ groups, current, onPage }: Props) {
  const entries = useMemo(() => groups.map((g) => ({ page: g.page, key: `${g.materialId}-${g.page}`, label: labelFor(g) })), [groups]);
  return (
    <nav aria-label="Pages of this Material" className="w-full">
      <p className="mb-3 text-[12.5px] font-medium text-faint">Pages</p>
      <ol className="space-y-0.5">
        {entries.map((e) => {
          const here = e.page === current;
          return (
            <li key={e.key}>
              <button
                type="button"
                onClick={() => onPage(e.page)}
                aria-current={here ? 'location' : undefined}
                className={cn(
                  'console-focusable flex min-h-6 w-full items-baseline gap-2 rounded-md py-1 text-left text-[12.5px] leading-[1.35] transition-colors',
                  here ? 'font-medium text-foreground' : 'text-faint hover:text-quiet',
                )}
              >
                <span className="w-5 shrink-0 tabular-nums">{e.page || '·'}</span>
                <span className="line-clamp-2">{e.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
