import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import type { Insight } from '@/features/analytics/types';
import { attentionStyle } from './attention';
import { Layer2Viz } from './Layer2Viz';

interface InsightCardProps {
  insight: Insight;
  isExpanded: boolean;
  dimmed: boolean;
  onExpand: (id: string) => void;
  onCollapse: () => void;
}

export function InsightCard({ insight, isExpanded, dimmed, onExpand, onCollapse }: InsightCardProps) {
  const s = attentionStyle(insight.attention);
  const cueMetric = insight.cue?.metric;
  // The positive "healthy" kind is genuinely reassuring; other calm-band cards
  // are low-grade problems and should read "Minor", not "Healthy".
  const statusLabel = insight.kind === 'healthy' ? 'Healthy' : s.label;

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
      animate={{ opacity: dimmed ? 0.35 : 1, filter: dimmed ? 'blur(1px)' : 'blur(0px)' }}
      className={`glass-panel rounded-3xl border ${s.border} ${isExpanded ? s.glow : ''} overflow-hidden ${
        dimmed ? 'pointer-events-none' : ''
      } ${isExpanded ? 'col-span-full' : ''}`}
    >
      {!isExpanded ? (
        <button
          type="button"
          onClick={() => onExpand(insight.id)}
          className={`group w-full text-left p-7 transition-colors border border-transparent rounded-3xl ${s.ring}`}
        >
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${s.text}`}>{statusLabel}</span>
          </div>
          <h3 className="mt-4 text-xl font-semibold leading-snug text-foreground">{insight.headline}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{insight.summary}</p>
          {cueMetric && (
            <div className="mt-5 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${s.text}`}>{cueMetric.value}</span>
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{cueMetric.label}</span>
            </div>
          )}
        </button>
      ) : (
        <div className="p-7 sm:p-9">
          <button
            type="button"
            onClick={onCollapse}
            className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Back to the garden
          </button>

          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${s.text}`}>{statusLabel}</span>
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">{insight.headline}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{insight.interpretation || insight.summary}</p>

          <div className="mt-8">
            <Layer2Viz insight={insight} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
