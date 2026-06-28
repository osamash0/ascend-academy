/**
 * Tests for useLanguagePreference.
 *
 * I/O boundaries:
 *   - localStorage (spied, not stubbed — happy-dom has a real localStorage)
 *   - i18n.changeLanguage (mocked)
 *   - supabase (sharedSupabaseMock)
 *   - useAuth (mocked to control user + profile)
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

const changeLanguageMock = vi.fn().mockResolvedValue(undefined);
let currentI18nLanguage = 'en';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      i18n: {
        get language() { return currentI18nLanguage; },
        changeLanguage: changeLanguageMock,
      },
      t: (k: string) => k,
    }),
  };
});

// Controllable auth state
let authUser: { id: string } | null = { id: 'user-1' };
let authProfile: { preferred_language?: string } | null = null;

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: authUser,
    session: authUser ? { access_token: 'tok' } : null,
    profile: authProfile,
    refreshProfile: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { useLanguagePreference } from '@/hooks/useLanguagePreference';
import { LANGUAGE_STORAGE_KEY } from '@/i18n';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  supabaseMock.reset();
  changeLanguageMock.mockClear();
  currentI18nLanguage = 'en';
  authUser = { id: 'user-1' };
  authProfile = null;
  localStorage.clear();
});

// ─── Language resolution ──────────────────────────────────────────────────────

describe('useLanguagePreference — language resolution', () => {
  it('returns current i18n language as "en" when no profile/storage set', () => {
    const { result } = renderHook(() => useLanguagePreference());
    expect(result.current.language).toBe('en');
  });

  it('returns "de" when i18n is set to de', () => {
    currentI18nLanguage = 'de';
    const { result } = renderHook(() => useLanguagePreference());
    expect(result.current.language).toBe('de');
  });

  it('applies profile.preferred_language on mount and writes localStorage', async () => {
    authProfile = { preferred_language: 'de' };
    const { rerender } = renderHook(() => useLanguagePreference());
    await act(async () => { rerender(); });
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(changeLanguageMock).toHaveBeenCalledWith('de');
  });

  it('does NOT apply profile language if it is already the current i18n language', async () => {
    currentI18nLanguage = 'de';
    authProfile = { preferred_language: 'de' };
    renderHook(() => useLanguagePreference());
    await act(async () => {});
    // changeLanguage should not be called when language already matches
    expect(changeLanguageMock).not.toHaveBeenCalled();
  });

  it('ignores unsupported profile.preferred_language values', async () => {
    authProfile = { preferred_language: 'fr' }; // not a SupportedLanguage
    renderHook(() => useLanguagePreference());
    await act(async () => {});
    expect(changeLanguageMock).not.toHaveBeenCalled();
  });
});

// ─── setLanguage ─────────────────────────────────────────────────────────────

describe('useLanguagePreference — setLanguage', () => {
  it('calls i18n.changeLanguage and writes localStorage', async () => {
    supabaseMock.seed('profiles', [{ user_id: 'user-1', preferred_language: 'en' }]);
    const { result } = renderHook(() => useLanguagePreference());
    await act(async () => { await result.current.setLanguage('de'); });
    expect(changeLanguageMock).toHaveBeenCalledWith('de');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
  });

  it('persists preferred_language to the profiles table when signed in', async () => {
    supabaseMock.seed('profiles', [{ user_id: 'user-1', preferred_language: 'en' }]);
    const { result } = renderHook(() => useLanguagePreference());
    await act(async () => { await result.current.setLanguage('de'); });
    const row = supabaseMock.data['profiles']?.rows[0];
    expect(row?.preferred_language).toBe('de');
  });

  it('still switches language locally when Supabase update fails (non-fatal)', async () => {
    // Simulate Supabase update returning an error
    const originalFrom = supabaseMock.from;
    const fromSpy = vi.spyOn(supabaseMock, 'from').mockImplementation((table: string) => {
      const builder = originalFrom.call(supabaseMock, table);
      // Override update to return error
      const orig = builder.update.bind(builder);
      builder.update = (patch: Record<string, unknown>) => {
        const b = orig(patch);
        const origThen = b.then.bind(b);
        b.then = (fn: any) => origThen(() => fn({ data: null, error: { message: 'network error' } }));
        return b;
      };
      return builder;
    });
    const { result } = renderHook(() => useLanguagePreference());
    await act(async () => { await result.current.setLanguage('de'); });
    // Despite DB error, language was still changed locally
    expect(changeLanguageMock).toHaveBeenCalledWith('de');
    fromSpy.mockRestore();
  });

  it('does nothing for an unsupported language code', async () => {
    const { result } = renderHook(() => useLanguagePreference());
    // @ts-expect-error — testing unsupported value
    await act(async () => { await result.current.setLanguage('jp'); });
    expect(changeLanguageMock).not.toHaveBeenCalled();
  });

  it('does not write to profiles table when not signed in', async () => {
    authUser = null;
    const { result } = renderHook(() => useLanguagePreference());
    await act(async () => { await result.current.setLanguage('de'); });
    // No profile write should have happened (table should be untouched)
    expect(supabaseMock.data['profiles']).toBeUndefined();
  });
});
