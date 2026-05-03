import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import {
  isSupportedLanguage,
  LANGUAGE_STORAGE_KEY,
  type SupportedLanguage,
} from '@/i18n';

/**
 * Centralised language preference hook.
 *
 * Resolution order:
 *   1. Signed-in user's `profiles.preferred_language` (when available)
 *   2. localStorage (handled by i18next-browser-languagedetector)
 *   3. Browser language → 'de' if German, otherwise 'en'
 *
 * Writes are mirrored back to localStorage immediately and (when signed in)
 * to the user's profile row so the choice follows them across devices.
 *
 * The hook also normalises the initial browser fallback so a German browser
 * with no stored preference lands on `de` on first visit.
 */
export function useLanguagePreference() {
  const { i18n } = useTranslation();
  const { user, profile } = useAuth();
  const appliedProfileLangRef = useRef<string | null>(null);
  const initialFallbackAppliedRef = useRef(false);

  // Initial browser-language fallback (only when nothing is stored locally yet).
  useEffect(() => {
    if (initialFallbackAppliedRef.current) return;
    initialFallbackAppliedRef.current = true;
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && isSupportedLanguage(stored)) return;
    const browser = (navigator.language || 'en').toLowerCase();
    const fallback: SupportedLanguage = browser.startsWith('de') ? 'de' : 'en';
    if (i18n.language?.split('-')[0] !== fallback) {
      void i18n.changeLanguage(fallback);
    }
  }, [i18n]);

  // When the auth profile becomes available (or changes), prefer the
  // server-stored language over the locally-detected one.
  useEffect(() => {
    if (!profile) return;
    const profileLang = (profile as unknown as { preferred_language?: string }).preferred_language;
    if (!isSupportedLanguage(profileLang)) return;
    if (appliedProfileLangRef.current === profileLang) return;
    appliedProfileLangRef.current = profileLang;
    if (i18n.language?.split('-')[0] !== profileLang) {
      void i18n.changeLanguage(profileLang);
    }
  }, [profile, i18n]);

  const setLanguage = useCallback(
    async (lng: SupportedLanguage) => {
      if (!isSupportedLanguage(lng)) return;
      // Update i18n immediately — this also writes to localStorage via the
      // detector cache plugin.
      await i18n.changeLanguage(lng);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
      }
      // Persist to profile when signed in. Failure is non-fatal — the local
      // choice still applies for this session.
      if (user?.id) {
        try {
          await supabase
            .from('profiles')
            .update({ preferred_language: lng } as never)
            .eq('user_id', user.id);
          appliedProfileLangRef.current = lng;
        } catch (err) {
          console.warn('Failed to persist language preference to profile', err);
        }
      }
    },
    [i18n, user?.id],
  );

  const current: SupportedLanguage = (i18n.language?.split('-')[0] as SupportedLanguage) === 'de' ? 'de' : 'en';

  return { language: current, setLanguage };
}
