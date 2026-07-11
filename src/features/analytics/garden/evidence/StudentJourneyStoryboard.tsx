import { HelpCircle, X as XIcon, Check } from 'lucide-react';
import type { StudentJourneyEvidence, StudentJourneyStep } from '@/features/analytics/types';

const CONFIDENCE_TONE: Record<string, string> = {
  got_it: 'bg-teal-400/70',
  unsure: 'bg-amber-400/60',
  confused: 'bg-rose-400/70',
};

function dwellIntensity(seconds: number, maxSeconds: number): number {
  if (maxSeconds <= 0) return 0.15;
  return Math.max(0.15, Math.min(1, seconds / maxSeconds));
}

/** One student's slide path as a horizontal strip — dwell as intensity, confidence + quiz as markers. */
export function StudentJourneyStoryboard({ evidence }: { evidence: StudentJourneyEvidence }) {
  const steps = evidence.steps;
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded for this student yet.</p>;
  }

  const maxDwell = Math.max(...steps.map((s) => s.dwellSeconds), 1);

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Student journey</p>
      <div className="flex gap-1.5 overflow-x-auto pb-2">
        {steps.map((step: StudentJourneyStep) => (
          <div
            key={step.slideNumber}
            title={`Slide ${step.slideNumber}: ${step.title}`}
            className="flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-3"
          >
            <div
              className="h-10 w-full rounded bg-teal-400/40"
              style={{ opacity: dwellIntensity(step.dwellSeconds, maxDwell) }}
            />
            <span className="text-[10px] text-muted-foreground">{Math.round(step.dwellSeconds)}s</span>
            <div className="flex items-center gap-1">
              {step.confidence && (
                <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_TONE[step.confidence]}`} />
              )}
              {step.quizCorrect === true && <Check className="h-3 w-3 text-teal-300" />}
              {step.quizCorrect === false && <XIcon className="h-3 w-3 text-rose-300" />}
              {step.askedAi && <HelpCircle className="h-3 w-3 text-sky-300" />}
            </div>
            <span className="text-[10px] text-muted-foreground">#{step.slideNumber}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
