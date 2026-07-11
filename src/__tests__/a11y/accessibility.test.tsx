import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import { expect, test, describe, vi } from 'vitest';
import { GamificationProvider } from '@/lib/gamification/GamificationProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock useAuth to avoid requiring AuthProvider and throwing errors
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'test-user', app_metadata: { role: 'student' } },
    profile: null,
    refreshProfile: vi.fn(),
    session: {},
  }),
}));

// Import pages to test
import Auth from '@/pages/Auth';
import StudentDashboard from '@/pages/StudentDashboard';
import AdvancedAnalytics from '@/pages/AdvancedAnalytics';
import MyMaterialsPage from '@/features/materials/MyMaterialsPage';

expect.extend(matchers);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

describe('Accessibility (A11y)', () => {
  test('Auth page should have no accessibility violations', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Auth />
        </MemoryRouter>
      </QueryClientProvider>
    );
    // Testing basic WCAG rules
    const results = await axe(container);
    (expect(results) as any).toHaveNoViolations();
  });

  test('StudentDashboard should have no accessibility violations', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <GamificationProvider>
            <StudentDashboard />
          </GamificationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    // Testing landmarks, headings, images
    const results = await axe(container);
    (expect(results) as any).toHaveNoViolations();
  });

  test('AdvancedAnalytics should have no accessibility violations', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AdvancedAnalytics />
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    const results = await axe(container);
    // Ignore color-contrast for charts if they fail natively from recharts
    // For now we test general structure
    (expect(results) as any).toHaveNoViolations();
  });

  test('MyMaterialsPage should have no accessibility violations', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MyMaterialsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const results = await axe(container);
    (expect(results) as any).toHaveNoViolations();
  });
});
