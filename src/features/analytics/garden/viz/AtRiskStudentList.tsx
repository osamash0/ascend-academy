import type { Insight } from '@/features/analytics/types';
import type { EvidenceRequest } from '../useGardenState';

interface RiskStudent {
  studentId?: string;
  name: string;
  progress: number;
  quizScore: number;
  aiInteractions: number;
}

interface AtRiskStudentListProps {
  insight: Insight;
  onOpenEvidence?: (request: EvidenceRequest) => void;
}

/** Anonymized list of at-risk students for the Silent Strugglers insight. */
export function AtRiskStudentList({ insight, onOpenEvidence }: AtRiskStudentListProps) {
  const students = (insight.detail?.students as RiskStudent[] | undefined) ?? [];

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">No students to show.</p>;
  }

  const canDrillIn = onOpenEvidence && insight.evidenceKinds.includes('student_journey');

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5">
      <div className="grid grid-cols-12 gap-2 border-b border-white/5 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="col-span-5">Student</span>
        <span className="col-span-2 text-right">Progress</span>
        <span className="col-span-2 text-right">Quiz</span>
        <span className="col-span-2 text-right">Asked AI</span>
        {canDrillIn && <span className="col-span-1" />}
      </div>
      {students.map((s, i) => (
        <div
          key={`${s.name}-${i}`}
          className="grid grid-cols-12 items-center gap-2 px-5 py-3 text-sm text-foreground odd:bg-white/[0.015]"
        >
          <span className="col-span-5 truncate">{s.name}</span>
          <span className="col-span-2 text-right tabular-nums text-muted-foreground">{s.progress}%</span>
          <span className="col-span-2 text-right tabular-nums text-muted-foreground">{s.quizScore}%</span>
          <span className="col-span-2 text-right tabular-nums text-muted-foreground">{s.aiInteractions}</span>
          {canDrillIn && (
            <span className="col-span-1 text-right">
              {s.studentId && (
                <button
                  type="button"
                  onClick={() => onOpenEvidence!({ kind: 'student_journey', studentId: s.studentId })}
                  className="text-xs font-medium text-teal-300/80 transition-colors hover:text-teal-200"
                >
                  Journey
                </button>
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
