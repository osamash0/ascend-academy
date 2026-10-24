/**
 * The real route guards, mounted on the routes they guard in App.tsx, for each
 * kind of person who can be signed in. Regression cover for the 2026-10-24
 * audit: an admin, or an account whose role lookup failed, who had not done
 * onboarding bounced /dashboard → /onboarding → /dashboard forever.
 *
 * A loop would not fail on its own here (it would hang or run out of memory),
 * so `LoopTrap` counts navigations and throws after a handful.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

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
vi.mock('@/pages/FirstRun', () => ({ default: () => <div>first-run</div> }));

const user = { id: 'u1', email: 'a@b.c' };
const fresh = { has_completed_activation_onboarding: false, full_name: null };
const done = { has_completed_activation_onboarding: true, full_name: 'Alice' };

function persona(role: string | null, profile: object | null) {
  useAuthMock.mockReturnValue({
    user,
    session: {},
    profile,
    role,
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

function LoopTrap() {
  const location = useLocation();
  const w = window as unknown as { __hops?: number };
  w.__hops = (w.__hops ?? 0) + 1;
  if (w.__hops > 12) throw new Error(`redirect loop, last at ${location.pathname}`);
  return null;
}

async function mountAt(path: string) {
  const App = await import('@/App');
  const { PublicRoute, ProtectedRoute, StudentDashboardRoute, OnboardingRoute, FirstRunGate } = App;
  render(
    <MemoryRouter initialEntries={[path]}>
      <LoopTrap />
      <Routes>
        <Route path="/" element={<PublicRoute><div>landing</div></PublicRoute>} />
        <Route path="/auth" element={<PublicRoute><div>auth</div></PublicRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><StudentDashboardRoute /></ProtectedRoute>} />
        <Route
          path="/onboarding"
          element={<ProtectedRoute allowedRoles={['student']}><OnboardingRoute /></ProtectedRoute>}
        />
        <Route path="/onboarding/start" element={<div>activation</div>} />
        <Route path="/v4/home" element={<ProtectedRoute><FirstRunGate><div>v4-home</div></FirstRunGate></ProtectedRoute>} />
        <Route path="/admin/dashboard" element={<div>admin-dashboard</div>} />
        <Route path="/professor/dashboard" element={<div>professor-dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  (window as unknown as { __hops?: number }).__hops = 0;
  useAuthMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('first-run routing, without v4', () => {
  it('admin who never onboarded lands on the admin dashboard, no loop', async () => {
    persona('admin', fresh);
    await mountAt('/dashboard');
    expect(await screen.findByText('admin-dashboard')).toBeInTheDocument();
  });

  it('role lookup failed and not onboarded: says so instead of looping', async () => {
    persona(null, fresh);
    await mountAt('/dashboard');
    expect(await screen.findByRole('heading', { name: /couldn't load your account/i })).toBeInTheDocument();
  });

  it('a new student signing in is sent to first run', async () => {
    persona('student', fresh);
    await mountAt('/auth');
    expect(await screen.findByText('first-run')).toBeInTheDocument();
  });

  it('a professor who opens /onboarding ends on their dashboard', async () => {
    persona('professor', fresh);
    await mountAt('/onboarding');
    expect(await screen.findByText('professor-dashboard')).toBeInTheDocument();
  });

  it('an onboarded student who reopens /onboarding is sent on, not shown it again', async () => {
    persona('student', done);
    await mountAt('/onboarding');
    expect(await screen.findByText('student-dashboard')).toBeInTheDocument();
  });
});

describe('first-run routing, with v4 live', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    vi.stubEnv('VITE_FEATURE_V4', '1');
  });

  it('an onboarded student signing in lands in v4 Home', async () => {
    persona('student', done);
    await mountAt('/auth');
    expect(await screen.findByText('v4-home')).toBeInTheDocument();
  });

  it('a deep link into v4 cannot skip first run', async () => {
    persona('student', fresh);
    await mountAt('/v4/home');
    expect(await screen.findByText('first-run')).toBeInTheDocument();
  });

  it('an admin may open v4 without being sent to first run', async () => {
    persona('admin', fresh);
    await mountAt('/v4/home');
    expect(await screen.findByText('v4-home')).toBeInTheDocument();
  });
});
