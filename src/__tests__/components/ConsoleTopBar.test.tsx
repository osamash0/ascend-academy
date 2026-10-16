import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

const { signOutFn } = vi.hoisted(() => ({ signOutFn: vi.fn() }));

vi.mock('@/lib/featureFlags', () => ({
  FEATURES: { studentUploads: true, globalSearch: false, reviewEngine: false },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ role: 'student', signOut: signOutFn }),
}));

vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/UploadsIndicator', () => ({ UploadsIndicator: () => null }));
vi.mock('@/components/console/ProfileChip', () => ({
  ProfileChip: ({ compact }: { compact?: boolean }) => <button aria-label="Open account menu" data-compact={String(!!compact)} />,
}));

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

  it('never lets the identity group (Home button + ProfileChip) be flex-shrunk by the rest of the header (M24)', () => {
    renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

    const homeButton = screen.getByRole('button', { name: 'Home' });
    const identityGroup = homeButton.parentElement;
    // Without shrink-0 here, a long ProfileChip name (rendered as a sibling
    // of this Home button) could compress this whole group toward zero
    // width while its unclipped content still overlapped the center nav -
    // the exact M24 failure mode.
    expect(identityGroup?.className).toMatch(/shrink-0/);
  });

  // 2026-10-12: at 375px the bar measured 612px wide (every console page
  // scrolled sideways) and the account chip was hidden below md, taking
  // "My ID" with it. jsdom can't measure layout, so pin the breakpoints.
  describe('on phones', () => {
    it('keeps the account chip on every width, avatar-only on phones', () => {
      renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

      const chip = screen.getByRole('button', { name: 'Open account menu' });
      expect(chip).toHaveAttribute('data-compact', 'true');
    });

    it('moves the tab nav into a menu sheet below md', () => {
      renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/library'] });

      expect(screen.getByRole('link', { name: 'Library' }).closest('nav')).toHaveClass('hidden', 'md:flex');
      const trigger = screen.getByRole('button', { name: 'Open navigation' });
      expect(trigger).toHaveClass('md:hidden');

      fireEvent.click(trigger);
      const sheet = screen.getByRole('dialog');
      const library = within(sheet).getByRole('link', { name: 'Library' });
      expect(library).toHaveAttribute('href', '/library');
      expect(library).toHaveAttribute('aria-current', 'page');
    });

    it('hides the tray icons the account menu already offers below lg', () => {
      renderWithProviders(<ConsoleTopBar />, { initialEntries: ['/dashboard'] });

      expect(screen.getByRole('link', { name: 'Settings' })).toHaveClass('hidden', 'lg:flex');
      expect(screen.getByRole('button', { name: 'Sign out' })).toHaveClass('hidden', 'lg:flex');
    });
  });
});
