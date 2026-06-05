import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  /** Small uppercase kicker above the title. */
  eyebrow?: string;
  icon?: LucideIcon;
  /** Right-aligned slot, e.g. a "View all" link. */
  action?: ReactNode;
  className?: string;
}

/** Rail/section heading: optional icon + eyebrow + bold title + action slot. */
export function SectionHeader({ title, eyebrow, icon: Icon, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          {eyebrow && (
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/80">
              {eyebrow}
            </span>
          )}
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{title}</h2>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
