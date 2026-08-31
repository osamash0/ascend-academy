import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gradientFor } from '@/components/console';

/**
 * A Lesson as cover art.
 *
 * A v4 replacement for `ConsoleTile`, which bakes `uppercase font-black
 * tracking-[0.2em]` into its eyebrow and badge and is shared with the old
 * product — so its labels cannot be calmed without editing code this namespace
 * must not touch.
 *
 * Same geometry, same gradient set, same grid texture: it reads as the same
 * product. What changes is the type temperature — sentence case, medium
 * weight, no shouting. See BUILD-PROMPT.md §4, "Calm is the default".
 */

export interface LessonTileProps {
  title: string;
  /** Small label above the title, e.g. "Lesson 4". Sentence case, not upper. */
  eyebrow?: string;
  isActive?: boolean;
  gradientIndex?: number;
  /** 0–100. Rendered as a thin bar along the bottom edge. */
  progress?: number;
  /** Large faint icon behind the plate. Decoration only — never information. */
  watermark?: ReactNode;
  /** Shown top-right when the Lesson is finished. */
  done?: boolean;
  /** Markers that ride on the content: Origin, Grounding, state. */
  markers?: ReactNode;
  className?: string;
}

export function LessonTile({
  title,
  eyebrow,
  isActive = false,
  gradientIndex = 0,
  progress,
  watermark,
  done,
  markers,
  className,
}: LessonTileProps) {
  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden rounded-2xl border bg-gradient-to-br',
        gradientFor(gradientIndex),
        isActive
          ? 'border-white/30 shadow-[0_0_40px_-10px_rgba(255,255,255,0.28)] ring-1 ring-white/20'
          : 'border-white/10',
        className,
      )}
    >
      {/* Grid texture. Explicit zero-alpha white stop rather than the
          `transparent` keyword, which WebKit interpolates toward transparent
          black and renders as a visible seam. */}
      <div className="absolute inset-0 bg-[size:22px_22px] bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,rgba(255,255,255,0)_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,rgba(255,255,255,0)_1px)]" />

      {watermark !== undefined && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-center">
          {watermark}
        </div>
      )}

      {/* Origin / Grounding / state sit in the same place on every tile. */}
      {markers && (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
          {markers}
        </div>
      )}

      {done && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-success/90 px-2 py-[3px] text-[11px] font-medium text-white">
          <Check aria-hidden className="h-3 w-3" />
          Done
        </div>
      )}

      {/*
        The text block is anchored to the bottom edge, so it grows *upward* —
        which means its height has to be constant or a rail of tiles stops
        lining up. Both lines were free to wrap: "Advanced Topics in
        Cryptography" over "Differential Cryptanalysis" took two lines each and
        shunted that tile's eyebrow 39px and its title 21px above its
        neighbours', the one card in the row whose text visibly floated.

        So the eyebrow is held to one line and the title to a fixed two. The
        eyebrow is context and the tile's full identity is in the call site's
        `aria-label`, so clipping it costs nothing a reader needs; the title
        keeps both its lines whether or not it uses them. Every tile's block is
        now the same height for any string in the fixtures.
      */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-4 pt-12">
        {eyebrow && (
          <p className="mb-1 truncate text-[12px] font-normal text-quiet">{eyebrow}</p>
        )}
        {/* 2 lines × `leading-snug` (1.375em). Reserved, not merely capped. */}
        <h3 className="line-clamp-2 min-h-[2.75em] text-[15.5px] font-semibold leading-snug text-white">
          {title}
        </h3>
      </div>

      {progress !== undefined && progress > 0 && (
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
