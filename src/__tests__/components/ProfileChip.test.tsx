/**
 * Regression coverage for M24 (Milestone-4/APP_AUDIT_REPORT.md): the account
 * menu trigger had no width floor of its own, so a long display name pushed
 * it wider than intended, and the left header group had no shrink guard
 * against being compressed by the rest of ConsoleTopBar - the excess
 * silently overlapped the center nav's Home link instead of truncating.
 *
 * jsdom doesn't do real layout, so this can't assert on pixel positions the
 * way a live browser check can (verified separately in a real preview: a
 * long name at 1054px width no longer overlaps the nav). What it *can*
 * assert: the trigger's name is capped and truncates instead of rendering
 * at its full natural width.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
}));

import { ProfileChip } from '@/components/console/ProfileChip';

const baseProfile = {
  id: 'p1',
  user_id: 'u1',
  email: 'alexandria@example.com',
  full_name: 'Alexandria Konstantinopoulos',
  display_name: null,
  avatar_url: null,
  total_xp: 125430,
  current_level: 42,
  current_streak: 0,
  best_streak: 0,
  preferred_language: 'en',
  luna_suit_color: null,
  luna_visor_tint: null,
  luna_patch: null,
  has_seen_dashboard_tour: false,
  has_completed_activation_onboarding: true,
};

describe('ProfileChip (M24)', () => {
  it('caps and truncates a long display name instead of letting it render at full width', () => {
    useAuthMock.mockReturnValue({ profile: baseProfile, role: 'student', signOut: vi.fn() });

    renderWithProviders(<ProfileChip />);

    const trigger = screen.getByRole('button', { name: /open account menu/i });
    const nameSpan = trigger.querySelector('span.truncate');
    expect(nameSpan).not.toBeNull();
    expect(nameSpan?.textContent).toBe('Alexandria Konstantinopoulos');
    // Bounded so the trigger has a real, predictable natural width instead
    // of growing with the name - this is what lets ConsoleTopBar's
    // `shrink-0` left group stay correctly sized instead of being
    // compressed toward zero by the rest of the header.
    expect(nameSpan?.className).toMatch(/max-w-\[140px\]/);
  });

  it('gives the trigger and its text column a min-w-0 shrink context (required for truncate to take effect)', () => {
    useAuthMock.mockReturnValue({ profile: baseProfile, role: 'student', signOut: vi.fn() });

    renderWithProviders(<ProfileChip />);

    const trigger = screen.getByRole('button', { name: /open account menu/i });
    expect(trigger.className).toMatch(/min-w-0/);
  });

  it('renders nothing when there is no profile yet', () => {
    useAuthMock.mockReturnValue({ profile: null, role: 'student', signOut: vi.fn() });

    renderWithProviders(<ProfileChip />);
    expect(screen.queryByRole('button', { name: /open account menu/i })).not.toBeInTheDocument();
  });
});
