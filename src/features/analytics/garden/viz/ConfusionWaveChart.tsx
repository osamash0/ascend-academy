import { motion } from 'framer-motion';
import type { Insight } from '@/features/analytics/types';

function num(m: Insight['metrics'], k: string): number {
  const v = m[k];
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** A calm confidence-distribution bar plus the supporting signal tiles. */
export function ConfusionWaveChart({ insight }: { insight: Insight }) {
  const m = insight.metrics;
  const gotIt = num(m, 'gotIt');
  const unsure = num(m, 'unsure');
  const confused = num(m, 'confused');
  const total = Math.max(gotIt + unsure + confused, 1);

  const segs = [
    { label: 'Got it', value: gotIt, cls: 'bg-teal-400/80' },
    { label: 'Unsure', value: unsure, cls: 'bg-amber-400/80' },
    { label: 'Confused', value: confused, cls: 'bg-rose-400/85' },
  ];

  const avgDwell = num(m, 'avgDwellSeconds');
  const lectureAvg = num(m, 'lectureAvgDwellSeconds');
  const dwellRatio = lectureAvg > 0 ? avgDwell / lectureAvg : 1;

  const tiles = [
    { label: 'Asked the AI tutor', value: `${num(m, 'aiQueryCount')}` },
    { label: 'Backtracked to it', value: `${num(m, 'backNavCount')}` },
    {
      label: 'Time vs. lecture avg',
      value: lectureAvg > 0 ? `${dwellRatio.toFixed(1)}×` : '—',
    },
    { label: 'Ratings collected', value: `${num(m, 'ratingsTotal')}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          <span>How students felt</span>
          <span>{total} ratings</span>
        </div>
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/5">
          {segs.map((s) => (
            <motion.div
              key={s.label}
              className={s.cls}
              initial={{ width: 0 }}
              animate={{ width: `${(s.value / total) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              title={`${s.label}: ${s.value}`}
            />
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
          {segs.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${s.cls}`} />
              {s.label} {Math.round((s.value / total) * 100)}%
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-2xl font-semibold text-foreground">{t.value}</div>
            <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
