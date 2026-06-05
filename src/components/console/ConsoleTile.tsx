import type { ReactNode } from 'react';
import { Check, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gradientFor } from './constants';

export interface TileBadge {
  kind: 'done' | 'next' | 'custom';
  label: string;
  icon?: LucideIcon;
}

interface ConsoleTileProps {
  title: string;
  isActive: boolean;
  /** Explicit gradient class string; overrides gradientIndex. */
  gradient?: string;
  /** Cycles through COVER_GRADIENTS when no explicit gradient is given. */
  gradientIndex?: number;
  /** Big centered watermark — typically a number or icon. */
  watermark?: ReactNode;
  /** Small uppercase label above the title (e.g. "Lecture"). */
  eyebrow?: string;
  /** 0–100 progress shown as a thin bottom bar. */
  progress?: number;
  badge?: TileBadge;
  /**
   * How the active state reads: 'ring' adds a halo + border (library style);
   * 'scale' relies purely on size + a soft depth shadow (diegetic style).
   */
  selection?: 'ring' | 'scale';
}

/**
 * Gradient "cover art" card: watermark, corner badge, title plate and a thin
 * progress bar. Active state adds a ring + glow. Visuals match the original
 * StudentCourseLibrary tile exactly.
 */
export function ConsoleTile({
  title,
  isActive,
  gradient,
  gradientIndex = 0,
  watermark,
  eyebrow = 'Lecture',
  progress,
  badge,
  selection = 'ring',
}: ConsoleTileProps) {
  const grad = gradient ?? gradientFor(gradientIndex);
  const BadgeIcon = badge?.icon ?? (badge?.kind === 'done' ? Check : Sparkles);

  const activeClass =
    selection === 'scale'
      ? 'border-white/10 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.85)]'
      : 'border-white/40 shadow-[0_0_50px_-5px_rgba(99,102,241,0.55)] ring-2 ring-white/30';

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden rounded-2xl border bg-gradient-to-br',
        grad,
        isActive ? activeClass : 'border-white/10'
      )}
    >
      {/* subtle grid texture */}
      <div className="absolute inset-0 bg-[size:22px_22px] bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)]" />

      {/* Status corner */}
      {badge && (
        <div
          className={cn(
            'absolute top-3 right-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
            badge.kind === 'done'
              ? 'bg-emerald-500/90 text-white'
              : 'bg-white/90 text-slate-900'
          )}
        >
          <BadgeIcon className="w-3 h-3" /> {badge.label}
        </div>
      )}

      {/* Big watermark */}
      {watermark !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[110px] font-black leading-none text-white/15">{watermark}</span>
        </div>
      )}

      {/* Title plate */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">{eyebrow}</p>
        <h3 className="line-clamp-2 text-base font-black leading-tight text-white">{title}</h3>
      </div>

      {/* Progress bar */}
      {progress !== undefined && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
