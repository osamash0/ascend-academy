import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GitCompare, Loader2, TrendingUp, TrendingDown, Minus,
  Users, Clock, Target, Layers, BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getLectureBenchmarks,
  getCourseBenchmarks,
  type LectureBenchmarks,
  type CourseBenchmarks,
  type BenchmarkMetricPack,
  type BenchmarkPeerSummary,
} from '@/services/analyticsService';

type MetricKey = keyof BenchmarkMetricPack;

interface MetricDef {
  key: MetricKey;
  label: string;
  unit: '%' | 'min' | '#';
  /** When true, lower values are better (e.g. drop-off, struggle). */
  lowerIsBetter?: boolean;
  group: 'engagement' | 'quiz' | 'concepts' | 'slides';
}

const METRICS: MetricDef[] = [
  { key: 'avg_time_minutes',      label: 'Avg Time',           unit: 'min', group: 'engagement' },
  { key: 'completion_rate',       label: 'Completion',         unit: '%',   group: 'engagement' },
  { key: 'unique_students',       label: 'Unique Students',    unit: '#',   group: 'engagement' },
  { key: 'drop_off_rate',         label: 'Drop-off',           unit: '%',   group: 'engagement', lowerIsBetter: true },
  { key: 'avg_score',             label: 'Avg Quiz Score',     unit: '%',   group: 'quiz' },
  { key: 'mastery_rate',          label: 'Mastery (≥80%)',     unit: '%',   group: 'quiz' },
  { key: 'struggle_rate',         label: 'Struggle (<60%)',    unit: '%',   group: 'quiz', lowerIsBetter: true },
  { key: 'distractor_confusion',  label: 'Distractor Confusion', unit: '%', group: 'quiz', lowerIsBetter: true },
  { key: 'concept_count',         label: 'Distinct Concepts',  unit: '#',   group: 'concepts' },
  { key: 'needs_review_share',    label: 'Slides Needing Review', unit: '%', group: 'slides', lowerIsBetter: true },
];

const GROUPS: { id: MetricDef['group']; title: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'engagement', title: 'Student Engagement',  icon: Users },
  { id: 'quiz',       title: 'Quiz Performance',    icon: Target },
  { id: 'concepts',   title: 'Concept Coverage',    icon: Layers },
  { id: 'slides',     title: 'Slide Quality',       icon: BookOpen },
];

function formatValue(v: number, unit: MetricDef['unit']): string {
  if (unit === '#') return String(Math.round(v));
  if (unit === 'min') return `${v.toFixed(1)} min`;
  return `${v.toFixed(1)}%`;
}

function deltaIndicator(current: number, peerAvg: number, lowerIsBetter?: boolean) {
  const delta = current - peerAvg;
  // Treat near-zero deltas as "at baseline" so professors don't see a
  // misleading arrow for a 0.05% wobble.
  const denom = Math.max(Math.abs(peerAvg), 1);
  const relPct = (delta / denom) * 100;
  if (Math.abs(relPct) < 5) {
    return { Icon: Minus, cls: 'text-muted-foreground', label: 'At baseline', deltaPct: relPct };
  }
  const isBetter = lowerIsBetter ? delta < 0 : delta > 0;
  return {
    Icon: isBetter ? TrendingUp : TrendingDown,
    cls: isBetter ? 'text-success' : 'text-destructive',
    label: isBetter ? 'Above baseline' : 'Below baseline',
    deltaPct: relPct,
  };
}

function DistributionBar({
  value,
  summary,
  highlightLabel,
}: {
  value: number;
  summary: BenchmarkPeerSummary;
  highlightLabel: string;
}) {
  // Clamp to [min, max] bounded by current too, so the marker never overflows
  const lo = Math.min(summary.min, value);
  const hi = Math.max(summary.max, value);
  const span = Math.max(hi - lo, 0.0001);
  const pct = ((value - lo) / span) * 100;
  const avgPct = ((summary.avg - lo) / span) * 100;
  return (
    <div className="relative h-6 w-full">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface-2 border border-border overflow-hidden">
        <div
          className="absolute top-0 bottom-0 bg-primary/15"
          style={{ left: '0%', right: `${100 - Math.min(100, pct)}%` }}
        />
      </div>
      {/* peer avg tick */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-px bg-muted-foreground/60"
        style={{ left: `${Math.max(0, Math.min(100, avgPct))}%` }}
        title={`Peer avg ${summary.avg}`}
      />
      {/* current marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-background bg-primary shadow-glow-primary"
        style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
        title={`${highlightLabel}: ${value}`}
      />
    </div>
  );
}

function MetricRow({
  def,
  current,
  summary,
  highlightLabel,
}: {
  def: MetricDef;
  current: number;
  summary: BenchmarkPeerSummary;
  highlightLabel: string;
}) {
  const indicator = deltaIndicator(current, summary.avg, def.lowerIsBetter);
  const { Icon } = indicator;
  const deltaAbs = current - summary.avg;
  return (
    <div className="grid grid-cols-12 items-center gap-4 px-4 py-3 border-b border-border/40 last:border-b-0">
      <div className="col-span-12 md:col-span-3 text-sm font-bold text-foreground">
        {def.label}
      </div>
      <div className="col-span-3 md:col-span-2 text-sm font-black text-foreground">
        {formatValue(current, def.unit)}
      </div>
      <div className="col-span-3 md:col-span-2 text-xs text-muted-foreground">
        Peer avg <span className="font-bold text-foreground">{formatValue(summary.avg, def.unit)}</span>
      </div>
      <div className={`col-span-3 md:col-span-2 text-xs font-bold flex items-center gap-1.5 ${indicator.cls}`}>
        <Icon className="w-3.5 h-3.5" />
        {deltaAbs >= 0 ? '+' : ''}{def.unit === '#' ? Math.round(deltaAbs) : deltaAbs.toFixed(1)}{def.unit === '#' ? '' : def.unit === 'min' ? ' min' : '%'}
        <span className="text-muted-foreground/60 font-medium">
          ({indicator.deltaPct >= 0 ? '+' : ''}{indicator.deltaPct.toFixed(0)}%)
        </span>
      </div>
      <div className="col-span-3 md:col-span-3">
        <DistributionBar value={current} summary={summary} highlightLabel={highlightLabel} />
      </div>
    </div>
  );
}

export interface BenchmarksSectionProps {
  lectureId: string;
}

export function BenchmarksSection({ lectureId }: BenchmarksSectionProps) {
  const [scope, setScope] = useState<'lecture' | 'course'>('lecture');
  const [lecData, setLecData] = useState<LectureBenchmarks | null>(null);
  const [courseData, setCourseData] = useState<CourseBenchmarks | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lecture benchmarks (always fetched first since they include course_id)
  useEffect(() => {
    if (!lectureId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getLectureBenchmarks(lectureId)
      .then((d) => { if (!cancelled) setLecData(d); })
      .catch((e) => {
        console.error('Lecture benchmarks failed:', e);
        if (!cancelled) setError('Could not load benchmarks. Please retry.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lectureId]);

  // Course benchmarks loaded lazily when the user switches to the course scope.
  useEffect(() => {
    if (scope !== 'course') return;
    if (!lecData?.course_id) return;
    if (courseData?.course_id === lecData.course_id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCourseBenchmarks(lecData.course_id)
      .then((d) => { if (!cancelled) setCourseData(d); })
      .catch((e) => {
        console.error('Course benchmarks failed:', e);
        if (!cancelled) setError('Could not load course benchmarks.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, lecData?.course_id, courseData?.course_id]);

  const view = useMemo(() => {
    if (scope === 'lecture') {
      const data = lecData;
      const current = data?.current?.metrics ?? null;
      const summary = data?.summary ?? null;
      const peerCount = data?.peers.length ?? 0;
      const highlightLabel = data?.current?.title ?? 'This lecture';
      return { current, summary, peerCount, highlightLabel, courseId: data?.course_id ?? null };
    }
    const data = courseData;
    const current = data?.current?.metrics ?? null;
    const summary = data?.summary ?? null;
    const peerCount = data?.peers.length ?? 0;
    const highlightLabel = data?.current?.title ?? 'This course';
    return { current, summary, peerCount, highlightLabel, courseId: data?.course_id ?? null };
  }, [scope, lecData, courseData]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card border-border/50 rounded-[2.5rem] p-8 shadow-xl relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full -mr-16 -mt-16" />
      <div className="relative z-10 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-foreground flex items-center gap-3 tracking-tight">
            <GitCompare className="w-7 h-7 text-primary" /> Benchmarks
          </h3>
          <p className="text-xs font-bold text-muted-foreground mt-2 uppercase tracking-[0.2em] opacity-60">
            Compare against your own work — same course or your other courses
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={scope === 'lecture' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setScope('lecture')}
            className="rounded-xl h-9 text-[10px] font-black uppercase tracking-widest"
          >
            <Clock className="w-3.5 h-3.5 mr-1.5" /> Lecture vs siblings
          </Button>
          <Button
            variant={scope === 'course' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setScope('course')}
            disabled={!lecData?.course_id}
            className="rounded-xl h-9 text-[10px] font-black uppercase tracking-widest"
          >
            <BookOpen className="w-3.5 h-3.5 mr-1.5" /> Course vs courses
          </Button>
        </div>
      </div>

      {scope === 'course' && !lecData?.course_id && (
        <div className="text-center py-12 text-muted-foreground/70">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">This lecture isn't assigned to a course yet.</p>
          <p className="text-xs mt-1 opacity-70">Assign it to a course to enable course-level benchmarks.</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-bold uppercase tracking-widest">Computing benchmarks…</span>
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-10 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && view.current && view.summary && view.peerCount < 2 && (
        <div className="text-center py-12 text-muted-foreground/70">
          <GitCompare className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">Not enough peers to benchmark yet.</p>
          <p className="text-xs mt-1 opacity-70">
            {scope === 'lecture'
              ? 'Need at least 2 sibling lectures in this course to compare.'
              : 'Need at least 2 other courses to compare.'}
          </p>
        </div>
      )}

      {!loading && !error && view.current && view.summary && view.peerCount >= 2 && (
        <div className="space-y-6">
          <div className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
            Comparing <span className="text-foreground">{view.highlightLabel}</span> against{' '}
            <span className="text-foreground">{view.peerCount}</span>{' '}
            {scope === 'lecture' ? 'sibling lecture' : 'other course'}{view.peerCount === 1 ? '' : 's'}
          </div>

          {GROUPS.map(({ id, title, icon: Icon }) => {
            const groupMetrics = METRICS.filter((m) => m.group === id);
            return (
              <div key={id} className="rounded-2xl border border-border/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-2/40 border-b border-border/40">
                  <Icon className="w-4 h-4 text-primary" />
                  <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">
                    {title}
                  </h4>
                </div>
                <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 border-b border-border/40">
                  <div className="col-span-3">Metric</div>
                  <div className="col-span-2">This {scope}</div>
                  <div className="col-span-2">Peer avg</div>
                  <div className="col-span-2">Delta</div>
                  <div className="col-span-3">Distribution</div>
                </div>
                {groupMetrics.map((def) => (
                  <MetricRow
                    key={def.key}
                    def={def}
                    current={view.current![def.key]}
                    summary={view.summary![def.key]}
                    highlightLabel={view.highlightLabel}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
