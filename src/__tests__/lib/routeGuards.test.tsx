/**
 * Regression coverage for the role-routing race fix.
 *
 * The bugs being prevented:
 *   1. Student typing /professor/* gets stuck on a spinner because the
 *      guard sees `user` set but `role` still null.
 *   2. Professor login briefly flashes the student dashboard because the
 *      public-route redirect runs before the role lands.
 *
 * Both root-cause to "treat user-present + role-still-null as still
 * loading". The contract is enforced via `useAuth().loading` staying true
 * until both session AND role are settled, so the guards just check
 * `loading` and never have to inspect role nullability themselves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
}));

import { ProtectedRoute, PublicRoute } from '@/lib/routeGuards';

const baseAuth = {
  user: null,
  session: null,
  profile: null,
  role: null,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
};

beforeEach(() => {
  useAuthMock.mockReset();
});

function mountAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/auth" element={<div>auth-page</div>} />
        <Route path="/dashboard" element={<div>student-dashboard</div>} />
        <Route
          path="/professor/dashboard"
          element={<div>professor-dashboard</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows spinner while auth is loading (no role flash)', () => {
    useAuthMock.mockReturnValue({ ...baseAuth, loading: true });
    mountAt(
      '/professor/dashboard',
      <ProtectedRoute allowedRoles={['professor']}>
        <div>professor-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByTestId('route-guard-spinner')).toBeInTheDocument();
    expect(screen.queryByText('professor-content')).not.toBeInTheDocument();
    expect(screen.queryByText('student-dashboard')).not.toBeInTheDocument();
  });

  it('keeps spinning when user is set but role is still resolving', () => {
    // Simulate the race: signed-in user, role fetch in flight (loading
    // remains true thanks to the auth-context fix).
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: null,
      loading: true,
    });
    mountAt(
      '/professor/dashboard',
      <ProtectedRoute allowedRoles={['professor']}>
        <div>professor-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByTestId('route-guard-spinner')).toBeInTheDocument();
    expect(screen.queryByText('professor-content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /auth', () => {
    useAuthMock.mockReturnValue({ ...baseAuth, user: null, loading: false });
    mountAt(
      '/professor/dashboard',
      <ProtectedRoute>
        <div>protected</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('auth-page')).toBeInTheDocument();
  });

  it('redirects a student away from a professor-only route to /dashboard', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: 'student',
      loading: false,
    });
    mountAt(
      '/professor/dashboard',
      <ProtectedRoute allowedRoles={['professor']}>
        <div>professor-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('student-dashboard')).toBeInTheDocument();
    expect(screen.queryByText('professor-content')).not.toBeInTheDocument();
  });

  it('grants access when role matches', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: 'professor',
      loading: false,
    });
    mountAt(
      '/professor/dashboard',
      <ProtectedRoute allowedRoles={['professor']}>
        <div>professor-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('professor-content')).toBeInTheDocument();
  });

  it('falls back to /dashboard when role is unknown after timeout on a role-restricted route', () => {
    // Role lookup timed out → loading flipped false but role stayed null.
    // Guard must not render the protected content; bounce to the
    // role-neutral dashboard.
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: null,
      loading: false,
    });
    mountAt(
      '/professor/dashboard',
      <ProtectedRoute allowedRoles={['professor']}>
        <div>professor-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('student-dashboard')).toBeInTheDocument();
    expect(screen.queryByText('professor-content')).not.toBeInTheDocument();
  });
});

describe('PublicRoute', () => {
  it('shows spinner while auth is loading (prevents student-dashboard flash on professor login)', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: null,
      loading: true,
    });
    mountAt('/auth', <PublicRoute><div>auth-form</div></PublicRoute>);
    expect(screen.getByTestId('route-guard-spinner')).toBeInTheDocument();
    expect(screen.queryByText('student-dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('professor-dashboard')).not.toBeInTheDocument();
  });

  it('redirects a logged-in professor to /professor/dashboard', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: 'professor',
      loading: false,
    });
    mountAt('/auth', <PublicRoute><div>auth-form</div></PublicRoute>);
    expect(screen.getByText('professor-dashboard')).toBeInTheDocument();
  });

  it('redirects a logged-in student to /dashboard', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: 'student',
      loading: false,
    });
    mountAt('/auth', <PublicRoute><div>auth-form</div></PublicRoute>);
    expect(screen.getByText('student-dashboard')).toBeInTheDocument();
  });

  it('renders the public content for visitors who are not signed in', () => {
    useAuthMock.mockReturnValue({ ...baseAuth, user: null, loading: false });
    mountAt('/auth', <PublicRoute><div>auth-form</div></PublicRoute>);
    expect(screen.getByText('auth-form')).toBeInTheDocument();
  });
});
