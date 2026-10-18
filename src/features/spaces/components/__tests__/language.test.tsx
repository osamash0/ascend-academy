import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

/*
 * The app's language setting writes the profile through Supabase; that write
 * is the only thing replaced here. The switch itself is real i18n.
 */
const persisted: string[] = [];
vi.mock('@/hooks/useLanguagePreference', () => ({
  useLanguagePreference: () => {
    const { i18n: inst } = useTranslation();
    return {
      language: (inst.language || 'en').split('-')[0],
      setLanguage: async (lng: 'en' | 'de') => {
        persisted.push(lng);
        await inst.changeLanguage(lng);
      },
    };
  },
}));

import SettingsScreen from '../../screens/SettingsScreen';

afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
  persisted.length = 0;
});

describe('one language for the whole app', () => {
  it('choosing Deutsch switches the screen at once and saves the choice', async () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );
    // The screen settles from its loading state first.
    expect(await screen.findByRole('heading', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Deutsch' }));
    });

    expect(persisted).toEqual(['de']);
    expect(screen.getByRole('heading', { name: 'Sprache' })).toBeInTheDocument();
    expect(screen.getAllByText('Einstellungen').length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true');
  });

  it('every reader request says which language the app is showing', async () => {
    const calls: string[] = [];
    vi.doMock('@/lib/apiClient', () => ({
      apiClient: {
        get: async (path: string) => {
          calls.push(path);
          return {};
        },
        post: async (path: string) => {
          calls.push(path);
          return {};
        },
      },
    }));
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    const { loadLiveRepository } = await import('../../data/liveRepository');
    await act(() => i18n.changeLanguage('de'));
    const repo = await loadLiveRepository();
    await repo.explainPage('lec', 34);
    await repo.findInCourse('c', 'join');
    expect(calls).toEqual(['/api/v1/v4/reader/lectures/lec/pages/34/explain?lang=de', '/api/v1/v4/reader/courses/c/find?q=join&lang=de']);
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/apiClient');
  });
});
