import { Link } from 'react-router-dom';
import { ArrowUpRight, Calculator, Columns2, GitFork, ListOrdered, Table2, Workflow } from 'lucide-react';
import type { LessonTool } from '../../data/tools';

/**
 * What you can try in this Lesson, not just read.
 *
 * Explain answers some pages with a tool — a table that checks itself, a
 * closure calculator, a decomposer. They live on their pages in the reader;
 * this shelf is the way straight to one, opened at that page with Explain up.
 */

const ICON: Record<LessonTool['kind'], typeof Table2> = {
  fdTable: Table2,
  closure: Calculator,
  bcnf: GitFork,
  steps: ListOrdered,
  explore: Workflow,
  compare: Columns2,
};

const VERB: Record<LessonTool['kind'], string> = {
  fdTable: 'Break a dependency',
  closure: 'Compute a closure',
  bcnf: 'Decompose a relation',
  steps: 'Walk a proof',
  explore: 'Explore the parts',
  compare: 'Compare side by side',
};

export function ToolShelf({ tools, href }: { tools: LessonTool[]; href: (page: number) => string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <li key={t.page}>
            <Link
              to={href(t.page)}
              className="console-focusable group flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
            >
              <span className="mb-6 flex items-center justify-between">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'color-mix(in srgb, var(--lesson-accent,hsl(var(--secondary))) 22%, transparent)' }}
                >
                  <Icon aria-hidden className="h-[18px] w-[18px]" style={{ color: 'var(--lesson-accent,hsl(var(--secondary)))' }} />
                </span>
                <ArrowUpRight aria-hidden className="h-4 w-4 text-faint transition-colors group-hover:text-foreground" />
              </span>
              <span className="mb-1 text-[12.5px] text-quiet">
                {VERB[t.kind]} · page {t.page}
              </span>
              <span className="text-[15px] font-medium leading-[1.35] text-foreground">{t.title}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
