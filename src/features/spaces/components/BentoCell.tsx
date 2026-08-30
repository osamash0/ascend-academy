import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Floating glass cell — the panel every widget sits in.
 *
 * The PS5 home is a bento of heterogeneous cells: different spans, each with a
 * small icon-and-label header and its own kind of content — a stat, a list, a
 * bar, a slice of art. Size carries importance; nothing is a uniform grid.
 *
 * The product already ships this shape in `features/student/BentoGrid`, which
 * belongs to the old product and must not be imported. This is the same
 * language in the v4 namespace, shared by Home and the Space overview so the
 * two cannot drift apart.
 */
export function BentoCell({
  icon: Icon,
  label,
  className,
  onClick,
  art,
  children,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  onClick?: () => void;
  /**
   * Background art. Rendered as a direct child of the cell so it fills the
   * whole panel — passing it through `children` put it inside the content
   * wrapper, below the header row, which gave it a hard top edge partway down
   * the cell. It is also masked so it fades out instead of ending on a seam.
   */
  art?: React.ReactNode;
  children: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left transition-colors',
        onClick && 'console-focusable hover:bg-white/[0.06]',
        className,
      )}
    >
      {art && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black_25%,transparent_85%)]"
        >
          {art}
        </div>
      )}
      <div className="relative z-10 mb-3 flex items-center gap-2 text-quiet">
        <Icon aria-hidden className="h-4 w-4" />
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <div className="relative z-10">{children}</div>
    </Tag>
  );
}
