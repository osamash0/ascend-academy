import { MessageCircle } from 'lucide-react';
import type { AiQueriesEvidence } from '@/features/analytics/types';

/** v1 = raw grouped list (narrated NLP clustering is a Tier-2 enrichment). */
export function GroupedQueriesList({ evidence }: { evidence: AiQueriesEvidence }) {
  if (evidence.queries.length === 0) {
    return <p className="text-sm text-muted-foreground">No AI-tutor questions were asked on this slide.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        What students asked the AI here ({evidence.totalCount})
      </p>
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {evidence.queries.map((q, i) => (
          <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-start gap-2">
              <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400/70" />
              <p className="text-sm text-foreground">{q.query}</p>
            </div>
            {q.response && (
              <p className="mt-2 pl-6 text-xs leading-relaxed text-muted-foreground">{q.response}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
