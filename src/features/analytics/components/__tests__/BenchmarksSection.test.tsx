/**
 * A lecture fewer than five people opened has no benchmark figures: they render as a dash,
 * never as 0 or 100%, and carry no comparison arrow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';

const getLectureBenchmarks = vi.fn();
const getCourseBenchmarks = vi.fn();
vi.mock('@/services/analyticsService', () => ({
  getLectureBenchmarks: (...a: unknown[]) => getLectureBenchmarks(...a),
  getCourseBenchmarks: (...a: unknown[]) => getCourseBenchmarks(...a),
}));

import { BenchmarksSection } from '@/features/analytics/components/BenchmarksSection';

const KEYS = [
  'avg_time_minutes', 'completion_rate', 'unique_students', 'drop_off_rate', 'avg_score',
  'mastery_rate', 'struggle_rate', 'distractor_confusion', 'concept_count', 'needs_review_share',
] as const;
const pack = (fill: number | null) => Object.fromEntries(KEYS.map((k) => [k, fill]));
const summary = (v: number | null) =>
  Object.fromEntries(KEYS.map((k) => [k, { avg: v, min: v, max: v, count: v == null ? 0 : 2 }]));

function lecture(current: number | null, peerSummary: number | null) {
  return {
    scope: 'lecture', lecture_id: 'L1', course_id: 'C1',
    current: { lecture_id: 'L1', title: 'Joins', metrics: pack(current) },
    peers: [
      { lecture_id: 'L2', title: 'A', metrics: pack(peerSummary) },
      { lecture_id: 'L3', title: 'B', metrics: pack(peerSummary) },
    ],
    summary: summary(peerSummary),
  };
}

beforeEach(() => {
  getLectureBenchmarks.mockReset();
  getCourseBenchmarks.mockReset();
});

describe('BenchmarksSection', () => {
  it('shows a dash for every metric of a withheld lecture, never 0', async () => {
    getLectureBenchmarks.mockResolvedValue(lecture(null, 40));
    renderWithProviders(<BenchmarksSection lectureId="L1" />);

    const row = (await screen.findByText('Completion')).parentElement as HTMLElement;
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    expect(row.textContent).not.toMatch(/(^|\D)0\.0%|100\.0%/);
    expect(row.textContent).not.toMatch(/[+-]\d/);
  });

  it('shows a dash for the peer average of a metric no peer had a figure for', async () => {
    const data = lecture(40, 40);
    data.summary = { ...data.summary, completion_rate: { avg: null, min: null, max: null, count: 0 } };
    getLectureBenchmarks.mockResolvedValue(data);
    renderWithProviders(<BenchmarksSection lectureId="L1" />);

    const row = (await screen.findByText('Completion')).parentElement as HTMLElement;
    expect(row.textContent).toContain('40.0%');
    expect(row.textContent).toMatch(/Peer avg\s*—/);
  });

  it('still compares a lecture that has figures', async () => {
    getLectureBenchmarks.mockResolvedValue(lecture(40, 40));
    renderWithProviders(<BenchmarksSection lectureId="L1" />);

    const row = (await screen.findByText('Completion')).parentElement as HTMLElement;
    expect(row.textContent).toContain('40.0%');
    expect(row.textContent).toMatch(/\+0\.0%/);
  });

  it('counts only the peers that had a figure, not the withheld ones', async () => {
    const data = lecture(40, 40);
    // three siblings, two of them withheld: one contributing peer is not enough to compare
    data.peers = [
      { lecture_id: 'L2', title: 'A', metrics: pack(40) },
      { lecture_id: 'L3', title: 'B', metrics: pack(null) },
      { lecture_id: 'L4', title: 'C', metrics: pack(null) },
    ];
    data.summary = Object.fromEntries(KEYS.map((k) => [k, { avg: 40, min: 40, max: 40, count: 1 }])) as typeof data.summary;
    getLectureBenchmarks.mockResolvedValue(data);
    renderWithProviders(<BenchmarksSection lectureId="L1" />);

    expect(await screen.findByText(/not enough peers to benchmark yet/i)).toBeInTheDocument();
  });

  it('says how many peers it compared against, withheld ones left out', async () => {
    const data = lecture(40, 40);
    data.peers = [
      { lecture_id: 'L2', title: 'A', metrics: pack(40) },
      { lecture_id: 'L3', title: 'B', metrics: pack(40) },
      { lecture_id: 'L4', title: 'C', metrics: pack(null) },
    ];
    data.summary = Object.fromEntries(KEYS.map((k) => [k, { avg: 40, min: 40, max: 40, count: 2 }])) as typeof data.summary;
    getLectureBenchmarks.mockResolvedValue(data);
    renderWithProviders(<BenchmarksSection lectureId="L1" />);

    expect(await screen.findByText(/comparing/i)).toHaveTextContent(/against\s*2\s*sibling lectures/i);
  });
});
