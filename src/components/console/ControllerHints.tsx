import { cn } from '@/lib/utils';

export interface ControllerHint {
  /** Glyph text, e.g. "LB", "RB", "A". */
  key: string;
  label: string;
}

interface ControllerHintsProps {
  hints: ControllerHint[];
  className?: string;
}

/**
 * Quiet, monochrome controller-button footnotes (LB / RB / A …) — navigational
 * hints for those who want them, invisible to those who've internalized them.
 */
export function ControllerHints({ hints, className }: ControllerHintsProps) {
  return (
    <div className={cn('flex items-center gap-5 text-[11px] font-bold text-white/45', className)}>
      {hints.map((h) => (
        <span key={h.key + h.label} className="flex items-center gap-1.5">
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full border border-white/40 px-1 text-[10px] font-black text-white/70">
            {h.key}
          </span>
          {h.label}
        </span>
      ))}
    </div>
  );
}
