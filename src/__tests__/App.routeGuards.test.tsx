/**
 * Regression coverage for R7 (Milestone-4/APP_AUDIT_REPORT.md Part 4.2):
 * `ProtectedRoute` used to fail OPEN on an unknown role.
 *
 * The guard was `allowedRoles && role && !allowedRoles.includes(role)` —
 * when `role` was falsy (null/undefined) the entire role check was skipped
 * and the route rendered anyway. `role` legitimately ends up `null` after
 * `loading` has settled: src/lib/auth.tsx's `fetchRole` only calls
 * `setRole(...)` `if (roleData)`, and a rejected/timed-out lookup is
 * swallowed by `.catch(() => {})` while `roleLoading` is still cleared (see
 * the comment there: "we then leave `role` as whatever fetchRole managed to
 * set (null if nothing), but mark the lookup as resolved so guards stop
 * spinning"). A student whose role read times out could therefore land on
 * an admin-only route with the page shell fully rendered.
 *
 * The fix treats a falsy role AFTER loading has resolved as "does not have
 * access" (fail closed) and redirects using the same fallback already used
 * for a known-but-wrong role, while still showing the loading spinner (not
 * denying, not rendering) while the role lookup is genuinely still in
 * flight (`loading === true`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { ProtectedRoute } from '@/App';

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
        <Route path="/admin/dashboard" element={<div>admin-dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute — R7 fail-closed regression', () => {
  it('denies (redirects) an admin-only route when role resolved to null (e.g. a timed-out role lookup)', () => {
    // loading === false: the role lookup has SETTLED (success, failure, or
    // timeout — see src/lib/auth.tsx `loading = sessionLoading || roleLoading`).
    // A signed-in user with a still-null role at this point must be denied,
    // not let through.
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: null,
      loading: false,
    });
    mountAt(
      '/admin/dashboard',
      <ProtectedRoute allowedRoles={['admin']}>
        <div>admin-content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
    expect(screen.getByText('student-dashboard')).toBeInTheDocument();
  });

  it('denies (redirects) when role is undefined after loading resolves', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: undefined,
      loading: false,
    });
    mountAt(
      '/admin/dashboard',
      <ProtectedRoute allowedRoles={['admin']}>
        <div>admin-content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
    expect(screen.getByText('student-dashboard')).toBeInTheDocument();
  });

  it('still shows the loading spinner (does not deny or render) while the role lookup is genuinely in flight', () => {
    // The legitimate case this fix must NOT regress: `loading === true`
    // means sessionLoading or roleLoading is still in flight. The guard
    // must keep spinning, not flash a redirect and not render content.
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: null,
      loading: true,
    });
    mountAt(
      '/admin/dashboard',
      <ProtectedRoute allowedRoles={['admin']}>
        <div>admin-content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
    expect(screen.queryByText('student-dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('auth-page')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /auth', () => {
    useAuthMock.mockReturnValue({ ...baseAuth, user: null, loading: false });
    mountAt(
      '/admin/dashboard',
      <ProtectedRoute allowedRoles={['admin']}>
        <div>admin-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('auth-page')).toBeInTheDocument();
  });

  it('redirects a known-but-wrong role (student on an admin-only route) to /dashboard', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: 'student',
      loading: false,
    });
    mountAt(
      '/admin/dashboard',
      <ProtectedRoute allowedRoles={['admin']}>
        <div>admin-content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
    expect(screen.getByText('student-dashboard')).toBeInTheDocument();
  });

  it('grants access when the resolved role matches', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: 'admin',
      loading: false,
    });
    mountAt(
      '/admin/dashboard',
      <ProtectedRoute allowedRoles={['admin']}>
        <div>admin-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('admin-content')).toBeInTheDocument();
  });

  it('grants access when no allowedRoles restriction is set, regardless of role', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      user: { id: 'u1' } as never,
      role: null,
      loading: false,
    });
    mountAt(
      '/dashboard',
      <ProtectedRoute>
        <div>any-authenticated-content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('any-authenticated-content')).toBeInTheDocument();
  });
});
