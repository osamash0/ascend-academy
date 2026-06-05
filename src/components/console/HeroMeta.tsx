import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface HeroMetaItem {
  label: string;
  value: ReactNode;
  /** Optional small icon shown before the value. */
  icon?: ReactNode;
}

interface HeroMetaProps {
  items: HeroMetaItem[];
  className?: string;
}

/** Metadata stat row under a hero title (e.g. Progress · Units · Quiz score). */
export function HeroMeta({ items, className }: HeroMetaProps) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-10 gap-y-4', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            {item.label}
          </span>
          <span className="flex items-center gap-1.5 text-lg font-black text-foreground">
            {item.icon}
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
