/**
 * Tests for ResetPassword page.
 *
 * I/O boundaries:
 *   - supabase.auth.onAuthStateChange / getSession (to detect recovery session)
 *   - supabase.auth.updateUser (to change password)
 *   - supabase.auth.signOut (post-change cleanup)
 *   - react-router useNavigate
 *   - useToast
 */
import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

const verifyOtpMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return {
    supabase: {
      ...m.sharedSupabaseMock,
      auth: { ...m.sharedSupabaseMock.auth, verifyOtp: verifyOtpMock },
    },
  };
});

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});


vi.mock('@/components/LanguageToggle', () => ({
  LanguageToggle: () => <div data-testid="lang-toggle" />,
}));

import ResetPassword from '@/pages/ResetPassword';
import i18n from '@/i18n';

function renderPage(strict = false) {
  const page = (
    <BrowserRouter>
      <ResetPassword />
    </BrowserRouter>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  supabaseMock.reset();
  vi.clearAllMocks();
  toastMock.mockClear();
  navigateMock.mockClear();
  verifyOtpMock.mockReset();
  window.history.replaceState(null, '', '/reset-password');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('ResetPassword', () => {
  it('waits for token-hash verification before showing the password form', async () => {
    window.history.replaceState(null, '', '/reset-password?token_hash=fixture-hash&type=recovery');
    const verified = { data: { session: { access_token: 'test-recovery-session' } }, error: null };
    let finishVerification: (value: typeof verified) => void;
    verifyOtpMock.mockReturnValueOnce(new Promise<typeof verified>((resolve) => {
      finishVerification = resolve;
    }));

    renderPage();
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'fixture-hash', type: 'recovery' });
    expect(screen.getByText(/Verifying your reset link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New password/i)).not.toBeInTheDocument();
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();

    await act(async () => { finishVerification(verified); });
    expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
  });

  it('verifies a single-use token only once during StrictMode effect replay', async () => {
    window.history.replaceState(null, '', '/reset-password?token_hash=fixture-hash&type=recovery');
    verifyOtpMock.mockResolvedValueOnce({ data: { session: { access_token: 'test-recovery-session' } }, error: null });

    renderPage(true);
    expect(await screen.findByLabelText(/^New password/i)).toBeInTheDocument();
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired token instead of falling back to an existing login', async () => {
    window.history.replaceState(null, '', '/reset-password?token_hash=expired-fixture&type=recovery');
    verifyOtpMock.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Expired token' } });

    renderPage();
    expect(await screen.findByText(/This reset link is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New password/i)).not.toBeInTheDocument();
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.auth.onAuthStateChange).not.toHaveBeenCalled();
  });

  it('shows the invalid-link state when verification fails to reach the server', async () => {
    window.history.replaceState(null, '', '/reset-password?token_hash=fixture-hash&type=recovery');
    verifyOtpMock.mockRejectedValueOnce(new Error('Network unavailable'));

    renderPage();
    expect(await screen.findByText(/This reset link is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New password/i)).not.toBeInTheDocument();
  });

  it.each([
    '?token_hash=fixture-hash&type=signup',
    '?token_hash=fixture-hash',
    '?token_hash=&type=recovery',
  ])('rejects malformed recovery parameters: %s', async (query) => {
    window.history.replaceState(null, '', `/reset-password${query}`);
    renderPage();

    expect(await screen.findByText(/This reset link is invalid or has expired/i)).toBeInTheDocument();
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
  });

  it('keeps implicit PASSWORD_RECOVERY events working for previously sent links', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const listener = vi.fn();
    supabaseMock.auth.onAuthStateChange.mockImplementationOnce((callback) => {
      listener.mockImplementation(callback);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    renderPage();
    act(() => { listener('PASSWORD_RECOVERY', null); });
    expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it('shows verifying state initially, then transitions to invalid if no session arrives', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    
    renderPage();
    expect(screen.getByText(/Verifying your reset link/i)).toBeInTheDocument();

    // The component waits 4000ms before showing invalid state
    expect(await screen.findByText(/This reset link is invalid or has expired/i, {}, { timeout: 4500 })).toBeInTheDocument();
  });

  it('transitions to ready state when getSession returns a session', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } }, error: null });
    
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
    });
  });

  it('validates password length and mismatch before submitting', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } }, error: null });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
    });

    // Too short
    await user.type(screen.getByLabelText(/^New password/i), '123');
    await user.type(screen.getByLabelText(/Confirm new password/i), '123');
    await user.click(screen.getByRole('button', { name: /Update password/i }));
    
    expect(await screen.findByText(/Password must be at least 8 characters/i)).toBeInTheDocument();
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();

    // Mismatch
    await user.clear(screen.getByLabelText(/^New password/i));
    await user.clear(screen.getByLabelText(/Confirm new password/i));
    await user.type(screen.getByLabelText(/^New password/i), '12345678');
    await user.type(screen.getByLabelText(/Confirm new password/i), '123456789');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser and signs out on success', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } }, error: null });
    supabaseMock.auth.updateUser.mockResolvedValueOnce({ data: { user: { id: '1' } }, error: null });
    supabaseMock.auth.signOut.mockResolvedValueOnce({ error: null });
    
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^New password/i), 'newpass123');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'newpass123');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    await waitFor(() => {
      expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
    });
    expect(supabaseMock.auth.signOut).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Password updated' }));
    
    expect(screen.getByText(/Password updated. Redirecting to sign in/i)).toBeInTheDocument();

    // Wait for the 1500ms timeout using real timers (will take 1.5s in test)
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/auth');
    }, { timeout: 2000 });
  });

  it('shows error toast when updateUser fails', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } }, error: null });
    supabaseMock.auth.updateUser.mockResolvedValueOnce({ data: null, error: { message: 'Weak password' } });
    
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^New password/i), '12345678');
    await user.type(screen.getByLabelText(/Confirm new password/i), '12345678');

    await user.click(screen.getByRole('button', { name: /Update password/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Weak password' }));
    });
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });
});
