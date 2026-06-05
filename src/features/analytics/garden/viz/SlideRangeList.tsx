import { motion } from 'framer-motion';
import type { Insight } from '@/features/analytics/types';

interface BlockSlide {
  slideNumber: number;
  title: string;
  confusionRate: number;
}

/** The contiguous slides in a Confusion Block, with their confusion levels. */
export function SlideRangeList({ insight }: { insight: Insight }) {
  const slides = (insight.detail?.slides as BlockSlide[] | undefined) ?? [];

  if (slides.length === 0) {
    return <p className="text-sm text-muted-foreground">No slides to show.</p>;
  }

  return (
    <div className="space-y-3">
      {slides.map((s) => (
        <div key={s.slideNumber} className="flex items-center gap-4">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
            Slide {s.slideNumber}
          </span>
          <span className="flex-1 truncate text-sm text-foreground">{s.title}</span>
          <div className="hidden h-2 w-32 overflow-hidden rounded-full bg-white/5 sm:block">
            <motion.div
              className="h-full bg-rose-400/80"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(s.confusionRate, 100)}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-sm tabular-nums text-rose-300">
            {Math.round(s.confusionRate)}%
          </span>
        </div>
      ))}
    </div>
  );
}
