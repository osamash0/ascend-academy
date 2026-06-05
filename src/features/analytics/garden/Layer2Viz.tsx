import type { Insight } from '@/features/analytics/types';
import { ConfusionWaveChart } from './viz/ConfusionWaveChart';
import { AtRiskStudentList } from './viz/AtRiskStudentList';
import { SlideRangeList } from './viz/SlideRangeList';
import { MetricTiles, type MetricTile } from './viz/MetricTiles';

function num(m: Insight['metrics'], k: string): number {
  const v = m[k];
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Dispatches an expanded insight to its kind-specific Layer-2 visualization. */
export function Layer2Viz({ insight }: { insight: Insight }) {
  const m = insight.metrics;

  switch (insight.kind) {
    case 'confusion_hotspot':
      return <ConfusionWaveChart insight={insight} />;

    case 'silent_strugglers':
      return <AtRiskStudentList insight={insight} />;

    case 'confusion_block':
      return <SlideRangeList insight={insight} />;

    case 'leaky_bucket': {
      const tiles: MetricTile[] = [
        { label: 'Drop-off after this slide', value: `${Math.round(num(m, 'attritionPct'))}%` },
        { label: 'Students before the drop', value: `${num(m, 'viewsBefore')}` },
        { label: 'Slide', value: `${num(m, 'slideNumber')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'quiz_misalignment': {
      const tiles: MetricTile[] = [
        { label: 'First-try pass rate', value: `${Math.round(num(m, 'quizSuccessRate'))}%` },
        { label: 'Felt confused', value: `${Math.round(num(m, 'confusionRate'))}%` },
        { label: 'Quiz attempts', value: `${num(m, 'quizAttempts')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'skipped_slide': {
      const tiles: MetricTile[] = [
        { label: 'Median time on slide', value: `${Math.round(num(m, 'medianDwellSeconds'))}s` },
        { label: 'Skimmed in under 4s', value: `${num(m, 'shortViews')}` },
        { label: 'Views', value: `${num(m, 'viewCount')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'silent_misleader': {
      const tiles: MetricTile[] = [
        { label: 'Felt sure', value: `${Math.round(num(m, 'gotItPct'))}%` },
        { label: 'First-try pass rate', value: `${Math.round(num(m, 'quizSuccessRate'))}%` },
        { label: 'Quiz attempts', value: `${num(m, 'quizAttempts')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'speed_bump': {
      const tiles: MetricTile[] = [
        { label: 'Backtracked from next slide', value: `${num(m, 'backtracksFromNext')}` },
        { label: 'Median time on slide', value: `${Math.round(num(m, 'medianDwellSeconds'))}s` },
        { label: 'Lecture median', value: `${Math.round(num(m, 'lectureMedianDwellSeconds'))}s` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'calibration_gap': {
      const tiles: MetricTile[] = [
        { label: 'Said "got it" but failed', value: `${Math.round(num(m, 'overconfidenceRate'))}%` },
        { label: 'Overconfident students', value: `${num(m, 'overconfidentCount')}` },
        { label: 'Confident & quizzed', value: `${num(m, 'confidentStudents')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'overpacked': {
      const tiles: MetricTile[] = [
        { label: 'Felt confused', value: `${Math.round(num(m, 'confusionRate'))}%` },
        { label: 'Median time on slide', value: `${Math.round(num(m, 'medianDwellSeconds'))}s` },
        { label: 'Asked the AI tutor', value: `${num(m, 'aiQueryCount')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    case 'healthy': {
      const tiles: MetricTile[] = [
        { label: 'Passed the quiz', value: `${Math.round(num(m, 'quizSuccessRate'))}%` },
        { label: 'Felt confused', value: `${Math.round(num(m, 'confusionRate'))}%` },
        { label: 'Slide', value: `${num(m, 'slideNumber')}` },
      ];
      return <MetricTiles tiles={tiles} />;
    }

    default:
      return (
        <p className="text-sm text-muted-foreground">
          Detailed view for this insight is coming soon.
        </p>
      );
  }
}
