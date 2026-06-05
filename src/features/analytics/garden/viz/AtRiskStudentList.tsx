import type { Insight } from '@/features/analytics/types';

interface RiskStudent {
  name: string;
  progress: number;
  quizScore: number;
  aiInteractions: number;
}

/** Anonymized list of at-risk students for the Silent Strugglers insight. */
export function AtRiskStudentList({ insight }: { insight: Insight }) {
  const students = (insight.detail?.students as RiskStudent[] | undefined) ?? [];

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">No students to show.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5">
      <div className="grid grid-cols-12 gap-2 border-b border-white/5 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="col-span-6">Student</span>
        <span className="col-span-2 text-right">Progress</span>
        <span className="col-span-2 text-right">Quiz</span>
        <span className="col-span-2 text-right">Asked AI</span>
      </div>
      {students.map((s, i) => (
        <div
          key={`${s.name}-${i}`}
          className="grid grid-cols-12 items-center gap-2 px-5 py-3 text-sm text-foreground odd:bg-white/[0.015]"
        >
          <span className="col-span-6 truncate">{s.name}</span>
          <span className="col-span-2 text-right tabular-nums text-muted-foreground">{s.progress}%</span>
          <span className="col-span-2 text-right tabular-nums text-muted-foreground">{s.quizScore}%</span>
          <span className="col-span-2 text-right tabular-nums text-muted-foreground">{s.aiInteractions}</span>
        </div>
      ))}
    </div>
  );
}
