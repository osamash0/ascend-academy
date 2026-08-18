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
});
