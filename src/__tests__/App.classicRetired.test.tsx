/**
 * LS-050: with v4 the product, the classic student app is retired for
 * students. Its rooms, old links, wrong-role redirects and the 404 all land in
 * v4; professors, admins, and everyone when v4 is off keep the classic pages.
 * Classic tools with no v4 room yet (review, exams…) are not touched.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Suspense, type ReactNode } from 'react';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});
vi.mock('@/pages/StudentDashboard', () => ({ default: () => <div>student-dashboard</div> }));
vi.mock('@/pages/NotFound', () => ({ default: () => <div>console-404</div> }));
vi.mock('@/components/console', () => ({
  ConsoleLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const done = { has_completed_activation_onboarding: true, full_name: 'Alice' };

function persona(role: string | null) {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', email: 'a@b.c' },
    session: {},
    profile: done,
    role,
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

async function mountAt(path: string) {
  const { ProtectedRoute, StudentDashboardRoute, StudentV4Redirect, ProtectedNotFound } = await import('@/App');
  const classic = (label: string) => <div>{label}</div>;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Suspense fallback={null}>
      <Routes>
        <Route path="/dashboard" element={<ProtectedRoute><StudentDashboardRoute /></ProtectedRoute>} />
        <Route
          path="/settings"
          element={<ProtectedRoute><StudentV4Redirect to="/v4/settings">{classic('classic-settings')}</StudentV4Redirect></ProtectedRoute>}
        />
        <Route
          path="/lecture/:lectureId"
          element={
            <ProtectedRoute>
              <StudentV4Redirect to={(p) => `/v4/lesson/${p.lectureId}`}>{classic('classic-lecture')}</StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/:userId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to={(p) => `/v4/person/${p.userId}`}>{classic('classic-person')}</StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route path="/review" element={<ProtectedRoute allowedRoles={['student']}>{classic('classic-review')}</ProtectedRoute>} />
        <Route path="/professor/dashboard" element={<ProtectedRoute allowedRoles={['professor']}>{classic('prof-dashboard')}</ProtectedRoute>} />
        <Route path="/v4/home" element={<div>v4-home</div>} />
        <Route path="/v4/settings" element={<div>v4-settings</div>} />
        <Route path="/v4/lesson/:lessonId" element={<div>v4-lesson-link</div>} />
        <Route path="/v4/person/:personId" element={<div>v4-person</div>} />
        <Route path="/v4/not-found" element={<div>v4-404</div>} />
        <Route path="*" element={<ProtectedNotFound />} />
      </Routes>
      </Suspense>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  useAuthMock.mockReset();
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

describe('LS-050: with v4 live, a student never lands in the classic app', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    vi.stubEnv('VITE_FEATURE_V4', '1');
  });

  it('the classic dashboard is v4 Home', async () => {
    persona('student');
    await mountAt('/dashboard');
    expect(await screen.findByText('v4-home')).toBeInTheDocument();
  });

  it('a classic room goes to its v4 room, keeping the query', async () => {
    persona('student');
    await mountAt('/settings?tab=data');
    expect(await screen.findByText('v4-settings')).toBeInTheDocument();
    expect(where()).toBe('/v4/settings?tab=data');
  });

  it('an old lecture link resolves through the v4 lesson link', async () => {
    persona('student');
    await mountAt('/lecture/l1?page=3');
    expect(await screen.findByText('v4-lesson-link')).toBeInTheDocument();
    expect(where()).toBe('/v4/lesson/l1?page=3');
  });

  it('a classic profile link opens the v4 person', async () => {
    persona('student');
    await mountAt('/profile/p9');
    expect(await screen.findByText('v4-person')).toBeInTheDocument();
    expect(where()).toBe('/v4/person/p9');
  });

  it('a wrong-role redirect lands a student in v4 Home, not /dashboard', async () => {
    persona('student');
    await mountAt('/professor/dashboard');
    expect(await screen.findByText('v4-home')).toBeInTheDocument();
  });

  it('an unknown address shows the 404 on the v4 stage', async () => {
    persona('student');
    await mountAt('/totally-unknown');
    expect(await screen.findByText('v4-404')).toBeInTheDocument();
  });

  it('classic tools with no v4 room stay where they are', async () => {
    persona('student');
    await mountAt('/review');
    expect(await screen.findByText('classic-review')).toBeInTheDocument();
  });

  it('a professor keeps the classic page and the console 404', async () => {
    persona('professor');
    await mountAt('/settings');
    expect(await screen.findByText('classic-settings')).toBeInTheDocument();
  });

  it('a professor on an unknown address gets the console 404', async () => {
    persona('professor');
    await mountAt('/totally-unknown');
    expect(await screen.findByText('console-404')).toBeInTheDocument();
  });
});

describe('without v4, nothing changes for students', () => {
  it('the classic pages and dashboard stay', async () => {
    persona('student');
    await mountAt('/settings');
    expect(await screen.findByText('classic-settings')).toBeInTheDocument();
  });

  it('the dashboard is the classic dashboard', async () => {
    persona('student');
    await mountAt('/dashboard');
    expect(await screen.findByText('student-dashboard')).toBeInTheDocument();
  });
});
