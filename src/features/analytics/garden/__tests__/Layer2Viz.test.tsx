/**
 * A tile never shows a count from fewer than five people: the backend sends null for it,
 * and the garden renders a dash, never 0 or a small number.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Layer2Viz } from '../Layer2Viz';
import type { Insight, InsightKind } from '@/features/analytics/types';

function insight(kind: InsightKind, metrics: Insight['metrics']): Insight {
  return {
    id: `${kind}:s1`, kind, scope: 'slide', severity: 0.5, attention: 'watch',
    headline: 'h', summary: 's', interpretation: 'i', targetRef: { slideNumber: 3 },
    cue: {}, metrics, detail: {}, evidenceKinds: [],
  };
}

const tileValue = (label: string) =>
  (screen.getByText(label).previousElementSibling as HTMLElement).textContent;

describe('Layer2Viz people counts', () => {
  it.each([
    ['speed_bump', 'backtracksFromNext', 'Backtracked from next slide'],
    ['skipped_slide', 'shortViews', 'Skimmed in under 4s'],
    ['overpacked', 'aiQueryCount', 'Asked the AI tutor'],
    ['calibration_gap', 'overconfidentCount', 'Overconfident students'],
  ] as const)('%s shows a dash when %s is withheld and the number when it is not', (kind, key, label) => {
    const { unmount } = render(<Layer2Viz insight={insight(kind, { [key]: null, viewCount: 9 })} />);
    expect(tileValue(label)).toBe('—');
    unmount();
    render(<Layer2Viz insight={insight(kind, { [key]: 6, viewCount: 9 })} />);
    expect(tileValue(label)).toBe('6');
  });

  it('the confusion wave shows a dash for withheld tutor questions and go-backs', () => {
    const m = { gotIt: 1, unsure: 1, confused: 4, ratingsTotal: 6, aiQueryCount: null, backNavCount: null };
    const { container } = render(<Layer2Viz insight={insight('confusion_hotspot', m)} />);
    expect(tileValue('Asked the AI tutor')).toBe('—');
    expect(tileValue('Backtracked to it')).toBe('—');
    expect(container.textContent).not.toMatch(/null/);
  });

  it('the confusion wave shows the numbers once five people stand behind them', () => {
    const m = { gotIt: 1, unsure: 1, confused: 4, ratingsTotal: 6, aiQueryCount: 5, backNavCount: 7 };
    render(<Layer2Viz insight={insight('confusion_hotspot', m)} />);
    expect(tileValue('Asked the AI tutor')).toBe('5');
    expect(tileValue('Backtracked to it')).toBe('7');
  });
});
