/**
 * Pin tests for the real AuthProvider state machine.
 *
 * routeGuards.test.tsx already pins how the guards REACT to auth state via a
 * mocked useAuth. These tests pin the provider that PRODUCES that state:
 *   - the two-phase (session → role) loading contract,
 *   - the "session exists but profile is missing → sign out" guard,
 *   - the signIn / signUp flows (incl. the privilege-escalation contract
 *     that signUp never writes user_roles from the client).
 *
 * The global useAuth mock installed by src/test/setup.ts is unmocked here so
 * we exercise the real implementation. The Supabase mock's onAuthStateChange
 * does not auto-fire, so we capture the callback and drive it manually.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

vi.unmock('@/lib/auth');
import { AuthProvider, useAuth } from '@/lib/auth';

type AuthCb = (event: string, session: unknown) => void | Promise<void>;
let authCb: AuthCb;
let ctx: ReturnType<typeof useAuth>;

function Probe() {
  ctx = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="user">{ctx.user?.id ?? 'none'}</span>
      <span data-testid="role">{ctx.role ?? 'none'}</span>
      <span data-testid="profile">{ctx.profile?.email ?? 'none'}</span>
    </div>
  );
}

function makeChannel() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ch: any = {};
  ch.on = vi.fn(() => ch);
  ch.subscribe = vi.fn(() => ch);
  return ch;
}

beforeEach(() => {
  supabaseMock.reset();
  toastMock.mockClear();
  supabaseMock.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });
  supabaseMock.auth.signOut.mockClear().mockResolvedValue({ error: null });
  supabaseMock.auth.signInWithPassword
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  supabaseMock.auth.signUp
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  supabaseMock.auth.onAuthStateChange.mockImplementation((cb: AuthCb) => {
    authCb = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  // The realtime profile subscription effect needs these; the base mock omits them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabaseMock as any).channel = vi.fn(() => makeChannel());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabaseMock as any).removeChannel = vi.fn();
  // signOut coordinates a backend logout POST before clearing local creds.
  server.use(
    http.post('http://api.test/api/v1/auth/logout', () => HttpResponse.json({})),
  );
});

async function fireAuth(event: string, session: unknown) {
  await act(async () => {
    await authCb(event, session);
  });
}

describe('AuthProvider — session/role state machine', () => {
  it('starts in a loading state before any auth event settles', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });

  it('settles to signed-out when there is no session', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await fireAuth('INITIAL_SESSION', null);
    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    );
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });

  it('loads profile AND role before clearing loading (two-phase contract)', async () => {
    supabaseMock.seed('profiles', [
      { id: 'p1', user_id: 'u1', email: 'stu@test.edu' },
    ]);
    supabaseMock.seed('user_roles', [{ user_id: 'u1', role: 'student' }]);
    render(<AuthProvider><Probe /></AuthProvider>);
    await fireAuth('INITIAL_SESSION', { user: { id: 'u1' } });
    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    );
    expect(screen.getByTestId('user')).toHaveTextContent('u1');
    expect(screen.getByTestId('profile')).toHaveTextContent('stu@test.edu');
    expect(screen.getByTestId('role')).toHaveTextContent('student');
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });

  it('signs the user out when a session exists but the profile is missing', async () => {
    // No profiles seeded → .single() returns a PGRST116 "no rows" error.
    supabaseMock.seed('user_roles', [{ user_id: 'u1', role: 'student' }]);
    render(<AuthProvider><Probe /></AuthProvider>);
    await fireAuth('INITIAL_SESSION', { user: { id: 'u1' } });
    await waitFor(() => expect(supabaseMock.auth.signOut).toHaveBeenCalled());
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('keeps the session but surfaces a toast on a transient profile-load error', async () => {
    // Force a non-PGRST116 (transient) error from the profiles read. The
    // base mock only ever returns rows or PGRST116, so override .from for
    // the profiles table to simulate a server/network failure.
    supabaseMock.seed('user_roles', [{ user_id: 'u1', role: 'student' }]);
    const realFrom = supabaseMock.from.bind(supabaseMock);
    const fromSpy = vi
      .spyOn(supabaseMock, 'from')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((table: string): any => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: { code: 'XX000', message: 'boom' },
                  }),
              }),
            }),
          };
        }
        return realFrom(table);
      });

    render(<AuthProvider><Probe /></AuthProvider>);
    await fireAuth('INITIAL_SESSION', { user: { id: 'u1' } });
    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    );

    // Loud: the user is told. Contained: NOT signed out, session preserved.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('user')).toHaveTextContent('u1');

    fromSpy.mockRestore();
  });
});

describe('AuthProvider — signIn / signUp', () => {
  it('signIn succeeds when the account still has a profile', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u1' } },
      error: null,
    });
    supabaseMock.seed('profiles', [
      { id: 'p1', user_id: 'u1', email: 'a@b.edu' },
    ]);
    render(<AuthProvider><Probe /></AuthProvider>);
    let res: { error: Error | null } = { error: new Error('unset') };
    await act(async () => {
      res = await ctx.signIn('a@b.edu', 'pw');
    });
    expect(res.error).toBeNull();
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });

  it('signIn rejects and signs out when the profile was deleted', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'ghost' } },
      error: null,
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    let res: { error: Error | null } = { error: null };
    await act(async () => {
      res = await ctx.signIn('g@b.edu', 'pw');
    });
    expect(res.error).toBeTruthy();
    expect(res.error?.message).toMatch(/deleted|support/i);
    expect(supabaseMock.auth.signOut).toHaveBeenCalled();
  });

  it('signUp passes the requested role via metadata and never writes user_roles from the client', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    let res: { error: Error | null } = { error: new Error('unset') };
    await act(async () => {
      res = await ctx.signUp('new@b.edu', 'pw', 'professor');
    });
    expect(res.error).toBeNull();
    expect(supabaseMock.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: { role: 'professor' } }),
      }),
    );
    // Privilege-escalation guard: the client must not insert into user_roles.
    expect(supabaseMock.data['user_roles']?.rows ?? []).toHaveLength(0);
  });
});
