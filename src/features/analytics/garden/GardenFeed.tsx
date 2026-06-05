import { AnimatePresence } from 'framer-motion';
import type { Insight } from '@/features/analytics/types';
import { InsightCard } from './InsightCard';

const VISIBLE_AT_REST = 4;

interface GardenFeedProps {
  insights: Insight[];
  expandedId: string | null;
  showAll: boolean;
  onExpand: (id: string) => void;
  onCollapse: () => void;
  onToggleShowAll: () => void;
}

export function GardenFeed({ insights, expandedId, showAll, onExpand, onCollapse, onToggleShowAll }: GardenFeedProps) {
  const expanded = insights.find((i) => i.id === expandedId);

  if (expanded) {
    return (
      <div className="grid grid-cols-1">
        <InsightCard insight={expanded} isExpanded dimmed={false} onExpand={onExpand} onCollapse={onCollapse} />
      </div>
    );
  }

  const visible = showAll ? insights : insights.slice(0, VISIBLE_AT_REST);
  const hiddenCount = insights.length - VISIBLE_AT_REST;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {visible.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              isExpanded={false}
              dimmed={false}
              onExpand={onExpand}
              onCollapse={onCollapse}
            />
          ))}
        </AnimatePresence>
      </div>

      {hiddenCount > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onToggleShowAll}
            className="rounded-full border border-white/10 px-5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
          >
            {showAll ? 'Show fewer' : `Show all findings (${hiddenCount} more)`}
          </button>
        </div>
      )}
    </div>
  );
}
