import { ChevronUp } from 'lucide-react';
import type { EvidenceRequest } from './useGardenState';
import { useEvidence } from '@/features/analytics/hooks/useEvidence';
import { GroupedQueriesList } from './evidence/GroupedQueriesList';
import { ConfidenceAccuracyGrid } from './evidence/ConfidenceAccuracyGrid';
import { StudentJourneyStoryboard } from './evidence/StudentJourneyStoryboard';

interface EvidenceDrawerProps {
  lectureId: string;
  request: EvidenceRequest;
  onClose: () => void;
}

/** Layer 3 — opens inside the expanded card; a single gesture collapses it back. */
export function EvidenceDrawer({ lectureId, request, onClose }: EvidenceDrawerProps) {
  const { data, isLoading, isError } = useEvidence(lectureId, request.kind, {
    slideId: request.slideId,
    studentId: request.studentId,
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronUp className="h-4 w-4" /> Collapse evidence
      </button>

      <div className="mt-4">
        {isLoading && <div className="h-24 animate-pulse rounded-xl bg-white/5" />}
        {isError && <p className="text-sm text-rose-300">Couldn't load the evidence. Please try again.</p>}
        {!isLoading && !isError && data?.kind === 'ai_queries' && <GroupedQueriesList evidence={data} />}
        {!isLoading && !isError && data?.kind === 'confidence_breakdown' && (
          <ConfidenceAccuracyGrid evidence={data} />
        )}
        {!isLoading && !isError && data?.kind === 'student_journey' && <StudentJourneyStoryboard evidence={data} />}
      </div>
    </div>
  );
}
