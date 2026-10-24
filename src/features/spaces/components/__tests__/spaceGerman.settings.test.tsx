import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

/*
 * Settings, in German: every section, switch, hint, the notice, the buttons
 * and the not-yet-wired notes. The viewer's name and rank title are demo data
 * and stay as they are — what is checked is the chrome around them.
 */

vi.mock('@/hooks/useLanguagePreference', () => ({
  useLanguagePreference: () => {
    const { i18n: inst } = useTranslation();
    return { language: (inst.language || 'en').split('-')[0], setLanguage: (l: string) => inst.changeLanguage(l) };
  },
}));

const toasts: Array<{ title: string; description?: string }> = [];
vi.mock('sonner', () => ({
  toast: (title: string, opts?: { description?: string }) => toasts.push({ title, description: opts?.description }),
}));

import SettingsScreen from '../../screens/SettingsScreen';

const ENGLISH_CHROME = [
  'Settings',
  'Language',
  'Loading',
  'Something went wrong',
  'Back to Profile',
  'Edit on Profile',
  'switches below',
  'Notifications',
  'replies to you',
  'endorsed',
  'starred',
  'Off by default',
  'Who can see you',
  'Public profile',
  'Show what I am reading',
  'Your data',
  'Export everything',
  'Export',
  'locked in',
  'Delete your account',
  'Delete',
  'Not wired',
  'Motion follows',
  'reduced motion',
];

/* The shared top bar and global nav are not this screen's; its own header is. */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header.sticky, nav').forEach((h) => h.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder],[alt]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:sections|language|states|nav)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
  toasts.length = 0;
  window.history.replaceState(null, '', '/');
});

const renderSettings = () =>
  render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );

describe('Settings, in German', () => {
  it('the whole screen says nothing in English', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { name: 'Benachrichtigungen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sprache' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wer dich sehen kann' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deine Daten' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Im Profil bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Wenn dir jemand antwortet' })).toHaveAccessibleDescription(
      'Eine Antwort auf deinen Beitrag oder eine Erwähnung mit deinem Namen.',
    );
    expect(screen.getByRole('switch', { name: 'Öffentliches Profil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Löschen' })).toHaveAttribute(
      'title',
      'In diesem Design-Build noch nicht angebunden',
    );
    expect(screen.getByLabelText('Zurück zum Profil')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the export note says, in German, that it is not built yet', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Exportieren' }));
    expect(toasts).toEqual([
      { title: 'Noch nicht angebunden', description: 'Der Export ist entworfen, aber in dieser Version noch nicht gebaut.' },
    ]);
  });

  it('loading and failure are said in German too', async () => {
    const { unmount } = renderSettings();
    expect(screen.getByText('Wird geladen …')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    unmount();

    window.history.replaceState(null, '', '/?mock=error');
    renderSettings();
    expect(await screen.findByText('Etwas ist schiefgelaufen')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
