/**
 * Where each kind of account ends up — through the real guards, chained the
 * way the app chains them.
 *
 * Regression for an infinite redirect: `/dashboard` sent every account that
 * had not finished onboarding to `/onboarding`, and `/onboarding` is
 * student-only, so an admin (or an account whose role lookup failed and
 * settled to null) was sent straight back to `/dashboard`, and round again,
 * until the tab ran out of memory. Wrong-role redirects also always went to
 * the *student* dashboard, so an admin opening a student page landed there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/pages/StudentDashboard', () => ({
  default: () => <div>student-dashboard</div>,
}));

import { ProtectedRoute, PublicRoute, StudentDashboardRoute } from '@/App';
import { homeForRole } from '@/lib/routes';

const user = { id: 'u1' } as never;
const onboarded = { id: 'u1', has_completed_activation_onboarding: true };
const fresh = { id: 'u1', has_completed_activation_onboarding: false };
const signOut = vi.fn();

function account(role: string | null, profile: object) {
  useAuthMock.mockReturnValue({
    user,
    session: {},
    role,
    profile,
    loading: false,
    signOut,
  });
}

function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <PublicRoute>
              <div>landing</div>
            </PublicRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <StudentDashboardRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <div>onboarding</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/library"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <div>student-library</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/dashboard"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <div>professor-dashboard</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <div>admin-dashboard</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
  signOut.mockReset();
});

describe('homeForRole', () => {
  it('is each role’s own dashboard', () => {
    expect(homeForRole('student')).toBe('/dashboard');
    expect(homeForRole('professor')).toBe('/professor/dashboard');
    expect(homeForRole('admin')).toBe('/admin/dashboard');
    expect(homeForRole(null)).toBe('/dashboard');
  });
});

describe('an admin who never did student onboarding', () => {
  it('opening /dashboard lands on the admin dashboard, not in a loop', async () => {
    account('admin', fresh);
    mountAt('/dashboard');
    expect(await screen.findByText('admin-dashboard')).toBeInTheDocument();
  });

  it('opening a student page lands on the admin dashboard', async () => {
    account('admin', fresh);
    mountAt('/library');
    expect(await screen.findByText('admin-dashboard')).toBeInTheDocument();
  });
});

describe('an onboarded admin', () => {
  it('is never shown the student dashboard', async () => {
    account('admin', onboarded);
    mountAt('/library');
    expect(await screen.findByText('admin-dashboard')).toBeInTheDocument();
    expect(screen.queryByText('student-dashboard')).not.toBeInTheDocument();
  });
});

describe('a professor on a student page', () => {
  it('lands on the professor dashboard', async () => {
    account('professor', onboarded);
    mountAt('/library');
    expect(await screen.findByText('professor-dashboard')).toBeInTheDocument();
  });
});

describe('an account whose role could not be loaded', () => {
  it.each([
    ['not onboarded', fresh],
    ['onboarded', onboarded],
  ])('(%s) sees an honest error with Retry and Sign out, never a loop or a student page', async (_, profile) => {
    account(null, profile);
    mountAt('/');
    expect(
      await screen.findByRole('heading', {
        name: /couldn.t load your account/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    screen.getByRole('button', { name: /sign out/i }).click();
    expect(signOut).toHaveBeenCalled();
    expect(screen.queryByText('student-dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument();
  });
});

describe('students are unchanged', () => {
  it('a new student goes to onboarding', async () => {
    account('student', fresh);
    mountAt('/dashboard');
    expect(await screen.findByText('onboarding')).toBeInTheDocument();
  });

  it('an onboarded student gets the dashboard', async () => {
    account('student', onboarded);
    mountAt('/');
    expect(await screen.findByText('student-dashboard')).toBeInTheDocument();
  });

  it('a student on a professor page goes to the student dashboard', async () => {
    account('student', onboarded);
    mountAt('/professor/dashboard');
    expect(await screen.findByText('student-dashboard')).toBeInTheDocument();
  });
});
