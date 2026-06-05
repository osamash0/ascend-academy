import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight, AlertTriangle, Sparkles } from 'lucide-react';
import { useInsights } from '@/features/analytics/hooks/useInsights';
import { SectionHeader } from '@/components/console';
import { useGardenState } from './useGardenState';
import { GardenFeed } from './GardenFeed';
import { HealthyEmptyState } from './HealthyEmptyState';
import { attentionStyle } from './attention';

export function InsightGarden({ lectureId, inline }: { lectureId: string; inline?: boolean }) {
  const { data, isLoading, isError, error } = useInsights(lectureId);
  const { expandedId, expand, collapse, showAll, toggleShowAll } = useGardenState();

  const insights = data?.insights ?? [];
  const topAttention = insights[0]?.attention;
  const showBanner = !expandedId && topAttention && topAttention !== 'calm';

  const advancedLink = (
    <Link
      to={`/professor/analytics/${lectureId}/advanced`}
      className="inline-flex items-center gap-1 text-xs font-medium text-white/55 transition-colors hover:text-white"
    >
      Open advanced analytics <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );

  return (
    <div className={inline ? 'relative w-full' : 'relative min-h-screen bg-background'}>
      {/* Ambient backdrop — calm, cheap, static (standalone only; the console
          provides its own depth scene in inline mode). */}
      {!inline && (
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_15%,rgba(45,212,191,0.06),transparent_55%),radial-gradient(circle_at_80%_85%,rgba(251,113,133,0.05),transparent_55%)]" />
        </div>
      )}

      {/* Share the console's horizontal rhythm (px-6 lg:px-12) so insights line
          up with the courses/lectures rails above. */}
      <div className={`relative z-10 ${inline ? 'px-6 lg:px-12 pt-2' : 'mx-auto max-w-5xl px-6 py-10 lg:py-14'}`}>
        {/* Standalone breadcrumb (the console header carries this in inline mode). */}
        {!inline && (
          <div className="mb-6 flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            <Link to="/professor/analytics" className="transition-colors hover:text-foreground">
              Lectures
            </Link>
            <span className="opacity-30">/</span>
            <span className="text-foreground">Insights</span>
          </div>
        )}

        <SectionHeader
          eyebrow="Insights"
          title="What needs your attention"
          icon={Sparkles}
          action={advancedLink}
        />

        {showBanner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`glass-panel mt-6 flex items-start gap-3 rounded-2xl border ${attentionStyle(topAttention).border} px-5 py-4`}
          >
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${attentionStyle(topAttention).text}`} />
            <p className="text-sm text-foreground">{insights[0].summary}</p>
          </motion.div>
        )}

        {/* Body */}
        <div className="mt-8">
          {isLoading && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="glass-panel h-44 animate-pulse rounded-3xl" />
              ))}
            </div>
          )}

          {isError && (
            <div className="glass-panel rounded-3xl border border-rose-500/30 px-8 py-12 text-center">
              <p className="text-sm text-rose-300">Couldn't load insights.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof Error ? error.message : 'Please try again.'}
              </p>
            </div>
          )}

          {!isLoading && !isError && insights.length === 0 && <HealthyEmptyState />}

          {!isLoading && !isError && insights.length > 0 && (
            <GardenFeed
              insights={insights}
              expandedId={expandedId}
              showAll={showAll}
              onExpand={expand}
              onCollapse={collapse}
              onToggleShowAll={toggleShowAll}
            />
          )}
        </div>
      </div>
    </div>
  );
}
