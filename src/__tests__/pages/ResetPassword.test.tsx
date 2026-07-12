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
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts: any) => opts?.defaultValue || key }),
  I18nextProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/LanguageToggle', () => ({
  LanguageToggle: () => <div data-testid="lang-toggle" />,
}));

import ResetPassword from '@/pages/ResetPassword';

function renderPage() {
  return render(
    <BrowserRouter>
      <ResetPassword />
    </BrowserRouter>
  );
}

beforeEach(() => {
  supabaseMock.reset();
  vi.clearAllMocks();
  toastMock.mockClear();
  navigateMock.mockClear();
});

describe('ResetPassword', () => {
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
    
    expect(await screen.findByText(/Password must be at least 6 characters/i)).toBeInTheDocument();
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();

    // Mismatch
    await user.clear(screen.getByLabelText(/^New password/i));
    await user.clear(screen.getByLabelText(/Confirm new password/i));
    await user.type(screen.getByLabelText(/^New password/i), '123456');
    await user.type(screen.getByLabelText(/Confirm new password/i), '1234567');
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

    await user.type(screen.getByLabelText(/^New password/i), '123456');
    await user.type(screen.getByLabelText(/Confirm new password/i), '123456');

    await user.click(screen.getByRole('button', { name: /Update password/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Weak password' }));
    });
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });
});
