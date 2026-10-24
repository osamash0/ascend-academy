/**
 * The first minutes of someone's first visit.
 *
 * - "Start learning" is for people with no account yet, so it opens the
 *   sign-up form, not the sign-in form.
 * - A link opened while signed out (a course a friend shared, an exam a
 *   professor posted) is where you meant to go: signing in takes you there,
 *   not to the dashboard. Only a path inside this app counts, so the
 *   parameter can never send anyone to another site.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import i18n from '@/i18n';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: {} } }));

import { ProtectedRoute, PublicRoute } from '@/App';
import { safeNextPath } from '@/lib/routes';
import Auth from '@/pages/Auth';

const signedOut = { user: null, session: null, role: null, profile: null, loading: false, signIn: vi.fn(), signUp: vi.fn() };
const student = (onboarded: boolean) => ({
  ...signedOut,
  user: { id: 'u1' },
  session: {},
  role: 'student',
  profile: { id: 'u1', has_completed_activation_onboarding: onboarded },
});

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<PublicRoute><Where /></PublicRoute>} />
        <Route path="/course/:id" element={<ProtectedRoute><Where /></ProtectedRoute>} />
        <Route path="/exam/take/:id" element={<ProtectedRoute><Where /></ProtectedRoute>} />
        <Route path="/dashboard" element={<Where />} />
        <Route path="/onboarding" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  useAuthMock.mockReset();
  await i18n.changeLanguage('en');
});

describe('safeNextPath', () => {
  it.each([
    ['/course/abc', '/course/abc'],
    ['/exam/take/1?attempt=2', '/exam/take/1?attempt=2'],
    [null, null],
    ['', null],
    ['https://evil.example', null],
    ['//evil.example/x', null],
    ['/\\evil.example', null],
    ['javascript:alert(1)', null],
    ['/auth', null],
    ['/auth?next=/auth', null],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('a link opened while signed out', () => {
  it('goes to sign-in and remembers where it was going', () => {
    useAuthMock.mockReturnValue(signedOut);
    mountAt('/exam/take/42?attempt=1');
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/auth?next=${encodeURIComponent('/exam/take/42?attempt=1')}`,
    );
  });

  it('after signing in, lands where it was going', () => {
    useAuthMock.mockReturnValue(student(true));
    mountAt(`/auth?next=${encodeURIComponent('/course/abc')}`);
    expect(screen.getByTestId('where')).toHaveTextContent('/course/abc');
  });

  it('a brand-new student still sets up first', () => {
    useAuthMock.mockReturnValue(student(false));
    mountAt(`/auth?next=${encodeURIComponent('/course/abc')}`);
    expect(screen.getByTestId('where')).toHaveTextContent('/onboarding');
  });

  it('never follows a next that leaves the app', () => {
    useAuthMock.mockReturnValue(student(true));
    mountAt(`/auth?next=${encodeURIComponent('//evil.example/phish')}`);
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard');
  });
});

describe('the auth page opens in the mode it was asked for', () => {
  function mountAuth(path: string) {
    useAuthMock.mockReturnValue(signedOut);
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('?mode=signup opens account creation', () => {
    mountAuth('/auth?mode=signup');
    expect(screen.getByRole('heading', { name: 'Start here.' })).toBeInTheDocument();
  });

  it('plain /auth opens sign-in', () => {
    mountAuth('/auth');
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  });
});
