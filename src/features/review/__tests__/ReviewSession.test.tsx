/**
 * Regression tests for R8 and R11 (Milestone-4/PROBLEMS.md).
 *
 * R11: useReviewQueue's `error` used to be ignored by ReviewSession, so a
 * failed queue fetch (cards: []) rendered the SAME success screen as a
 * genuinely empty queue ("You're all caught up"). An outage must render as
 * an error, not a celebratory empty state.
 *
 * R8: handleGrade awaited the grade mutation + grantXp with no try/catch and
 * was invoked as `void handleGrade(rating)` — a rejection was an unhandled
 * promise rejection: no toast, and the card silently never advanced. A
 * rejection must now show a toast and must NOT advance past the card.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'student@test.com' } }),
}));

const grantXpMock = vi.fn().mockResolvedValue(undefined);
const awardBadgeMock = vi.fn().mockResolvedValue(undefined);
const evaluateMock = vi.fn();
vi.mock('@/lib/gamification/GamificationProvider', () => ({
  GamificationProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useGamification: () => ({
    grantXp: grantXpMock,
    awardBadge: awardBadgeMock,
    evaluate: evaluateMock,
  }),
}));

vi.mock('@/services/reviewService', () => ({
  getStats: vi.fn().mockResolvedValue({ streak: 1 }),
}));

const useReviewQueueMock = vi.fn();
vi.mock('../useReviewQueue', () => ({
  useReviewQueue: () => useReviewQueueMock(),
}));

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motionProxy = new Proxy({} as any, {
    get: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ({ children, ...rest }: any) => {
        const {
          initial: _i, animate: _a, exit: _e, transition: _t, variants: _v,
          whileHover: _wh, whileTap: _wt, whileInView: _wi, whileFocus: _wf,
          drag: _d, layout: _l, layoutId: _li, custom: _c, viewport: _vp,
          ...domProps
        } = rest;
        return <div {...domProps}>{children}</div>;
      };
    },
  });
  return { ...actual, AnimatePresence: Passthrough, motion: motionProxy };
});

import ReviewSession from '../ReviewSession';

const CARD = {
  card_id: 'card-1',
  front: { question: 'What is 2+2?' },
  back: { correct_answer: '4' },
};

beforeEach(() => {
  toastMock.mockClear();
  grantXpMock.mockClear();
  awardBadgeMock.mockClear();
  evaluateMock.mockClear();
  useReviewQueueMock.mockReset();
});

describe('ReviewSession — R11 error vs. empty-queue state', () => {
  it('renders a real error state (not the caught-up success screen) when the queue fetch fails', () => {
    const refetch = vi.fn();
    useReviewQueueMock.mockReturnValue({
      cards: [],
      totalDue: 0,
      isLoading: false,
      error: new Error('network down'),
      refetch,
      grade: vi.fn(),
      isGrading: false,
    });

    renderWithProviders(<ReviewSession />);

    // Must NOT show the "all caught up" success copy for a failed fetch.
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
    // Must show a real error state instead.
    expect(screen.getByText(/couldn't load your review queue/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still renders the caught-up screen for a genuinely empty queue (no error)', () => {
    useReviewQueueMock.mockReturnValue({
      cards: [],
      totalDue: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      grade: vi.fn(),
      isGrading: false,
    });

    renderWithProviders(<ReviewSession />);

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load your review queue/i)).not.toBeInTheDocument();
  });
});

describe('ReviewSession — R8 grading failure handling', () => {
  it('shows an error toast and keeps the card in place when the grade mutation rejects', async () => {
    const grade = vi.fn().mockRejectedValue(new Error('save failed'));
    useReviewQueueMock.mockReturnValue({
      cards: [CARD],
      totalDue: 1,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      grade,
      isGrading: false,
    });

    renderWithProviders(<ReviewSession />);

    // Reveal the answer, then grade it.
    fireEvent.click(screen.getByTestId('review-card'));
    await waitFor(() => screen.getByTestId('grade-3'));
    fireEvent.click(screen.getByTestId('grade-3'));

    await waitFor(() => expect(grade).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });

    // The session must not silently advance past a failed grade — the same
    // card is still shown, not the "session complete" screen.
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
    expect(screen.queryByText(/session complete/i)).not.toBeInTheDocument();
    // grantXp must not have been called for a rejected grade.
    expect(grantXpMock).not.toHaveBeenCalled();
  });
});
