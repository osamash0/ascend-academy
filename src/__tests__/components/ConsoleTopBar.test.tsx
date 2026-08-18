import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/lib/featureFlags', () => ({
  FEATURES: { studentUploads: true, globalSearch: false, reviewEngine: false },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ role: 'student', signOut: vi.fn() }),
}));

vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/UploadsIndicator', () => ({ UploadsIndicator: () => null }));
vi.mock('@/components/console/ProfileChip', () => ({ ProfileChip: () => null }));

import { ConsoleTopBar } from '@/components/console/ConsoleTopBar';
import { FEATURES } from '@/lib/featureFlags';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('ConsoleTopBar student navigation', () => {
  afterEach(() => {
    (FEATURES as { studentUploads: boolean }).studentUploads = true;
    (FEATURES as { reviewEngine: boolean }).reviewEngine = false;
  });

  it('exposes My Materials as the active persistent tab instead of Create', () => {
    renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/materials'] });

    const materialsTab = screen.getByRole('link', { name: 'My Materials' });
    expect(materialsTab).toHaveAttribute('href', '/materials');
    expect(materialsTab).toHaveAttribute('aria-current', 'page');
    expect(materialsTab).toHaveClass('text-white');
    expect(screen.queryByRole('link', { name: 'Create' })).not.toBeInTheDocument();
  });

  it('hides My Materials while student uploads are disabled', () => {
    (FEATURES as { studentUploads: boolean }).studentUploads = false;

    renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

    expect(screen.queryByRole('link', { name: 'My Materials' })).not.toBeInTheDocument();
  });

  it('publishes its rendered height as --console-header-height (M5)', () => {
    document.documentElement.style.removeProperty('--console-header-height');
    renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

    expect(
      document.documentElement.style.getPropertyValue('--console-header-height'),
    ).toMatch(/^\d+px$/);
  });

  // R17: /review (Daily Ascent) previously had no persistent nav entry point
  // — its only door in was a home-feed tile gated on reviewDueCount > 0,
  // which silently collapsed to 0 (and the tile vanished) on a failed stats
  // fetch. A persistent tab guarantees an entry point regardless.
  it('exposes a persistent Review tab when the review engine feature is on', () => {
    (FEATURES as { reviewEngine: boolean }).reviewEngine = true;

    renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

    const reviewTab = screen.getByRole('link', { name: 'Review' });
    expect(reviewTab).toHaveAttribute('href', '/review');
  });

  it('hides the Review tab while the review engine feature is off', () => {
    renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument();
  });
});
