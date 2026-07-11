import type { ConfidenceBreakdownEvidence } from '@/features/analytics/types';

const CELLS: Array<{
  key: keyof ConfidenceBreakdownEvidence['quadrants'];
  label: string;
  hint: string;
  tone: string;
}> = [
  { key: 'confidentCorrect', label: 'Thought they knew — and did', hint: 'Confident, correct', tone: 'text-teal-300' },
  { key: 'confidentWrong', label: 'Thought they knew, but didn’t', hint: 'Confident, wrong', tone: 'text-rose-300' },
  { key: 'unsureCorrect', label: 'Unsure, but got it anyway', hint: 'Unsure, correct', tone: 'text-teal-300' },
  { key: 'unsureWrong', label: 'Unsure — and it showed', hint: 'Unsure, wrong', tone: 'text-amber-300' },
];

export function ConfidenceAccuracyGrid({ evidence }: { evidence: ConfidenceBreakdownEvidence }) {
  if (evidence.total === 0) {
    return <p className="text-sm text-muted-foreground">Not enough confidence + quiz pairs yet to compare.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Confidence vs. accuracy</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CELLS.map((cell) => {
          const count = evidence.quadrants[cell.key];
          const pct = Math.round((count / evidence.total) * 100);
          return (
            <div key={cell.key} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <p className="text-sm text-foreground">{cell.label}</p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${cell.tone}`}>{count}</span>
                <span className="text-xs text-muted-foreground">students · {pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
