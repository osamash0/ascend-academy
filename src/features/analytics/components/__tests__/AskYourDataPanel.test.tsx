/**
 * AskYourDataPanel tests.
 *
 * Locks in the user-visible behavior contract for the panel:
 *   * Empty state renders suggested-question chips and helper copy.
 *   * Submitting a question shows a loading state, then the answer summary.
 *   * Backend errors render a friendly error message (no crash).
 *   * Successful submissions are remembered in session-scoped recents and
 *     clicking a recent re-runs the same question.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/hooks/use-ai-model', () => ({ useAiModel: () => ({ aiModel: 'cerebras' }) }));

const askLectureData = vi.fn();
const getAskSuggestions = vi.fn();
vi.mock('@/services/analyticsService', () => ({
  askLectureData: (...a: unknown[]) => askLectureData(...a),
  getAskSuggestions: (...a: unknown[]) => getAskSuggestions(...a),
}));

import { AskYourDataPanel } from '@/features/analytics/components/AskYourDataPanel';

beforeEach(() => {
  askLectureData.mockReset();
  getAskSuggestions.mockReset();
  getAskSuggestions.mockResolvedValue([]);
  window.sessionStorage.clear();
});

describe('AskYourDataPanel', () => {
  it('renders suggested question chips in the empty state', async () => {
    renderWithProviders(<AskYourDataPanel lectureId="L1" />);
    expect(screen.getByText(/Ask Your Data/i)).toBeInTheDocument();
    expect(screen.getByText(/spot-check important numbers/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Which slide had the highest drop-off rate\?/i),
    ).toBeInTheDocument();
  });

  it('submits a question and renders the returned summary', async () => {
    askLectureData.mockResolvedValue({
      intent: 'completion_count',
      answer_text: '42 students finished the lecture.',
      table: [],
      chart: null,
      debug: {},
    });
    const user = userEvent.setup();
    renderWithProviders(<AskYourDataPanel lectureId="L1" />);

    const input = screen.getByPlaceholderText(/Which slide had the highest drop-off rate/i);
    await user.type(input, 'How many students finished?{Enter}');

    await waitFor(() =>
      expect(screen.getByText(/42 students finished the lecture\./)).toBeInTheDocument(),
    );
    expect(askLectureData).toHaveBeenCalledWith('L1', 'How many students finished?', 'cerebras');
  });

  it('renders a friendly error message when the backend fails', async () => {
    askLectureData.mockRejectedValue({ response: { data: { detail: 'Boom' } } });
    const user = userEvent.setup();
    renderWithProviders(<AskYourDataPanel lectureId="L1" />);

    const input = screen.getByPlaceholderText(/Which slide had the highest drop-off rate/i);
    await user.type(input, 'anything{Enter}');

    await waitFor(() => expect(screen.getByText(/Boom/)).toBeInTheDocument());
  });

  it('persists recents to sessionStorage and re-runs them on click', async () => {
    askLectureData.mockResolvedValue({
      intent: 'completion_count',
      answer_text: 'first answer',
      table: [],
      chart: null,
      debug: {},
    });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<AskYourDataPanel lectureId="L1" />);

    const input = screen.getByPlaceholderText(/Which slide had the highest drop-off rate/i);
    await user.type(input, 'first question{Enter}');
    await waitFor(() => expect(screen.getByText(/first answer/)).toBeInTheDocument());

    const stored = window.sessionStorage.getItem('ask-your-data:recent:L1');
    expect(stored).toContain('first question');

    unmount();

    askLectureData.mockClear();
    askLectureData.mockResolvedValue({
      intent: 'completion_count',
      answer_text: 'second answer',
      table: [],
      chart: null,
      debug: {},
    });

    renderWithProviders(<AskYourDataPanel lectureId="L1" />);
    const recentBtn = await screen.findByRole('button', { name: /first question/i });
    await user.click(recentBtn);

    await waitFor(() =>
      expect(askLectureData).toHaveBeenCalledWith('L1', 'first question', 'cerebras'),
    );
  });
});
