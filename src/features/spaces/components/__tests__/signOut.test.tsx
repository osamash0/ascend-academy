import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { SpacesTopBar } from '../SpacesTopBar';
import { viewer } from '../../mocks/people';
import { SessionActionsContext } from '../../data/session';

/*
 * Sign out in the v4 top bar.
 *
 * Live, v4 is behind sign-in, so a top bar whose sign-out never works traps
 * the user in their session. Demo has no session to end, so there the button
 * stays visibly inert and says why.
 */

const signOut = vi.fn(async () => {});

/** `session` is what App's bridge provides: the real sign-out when signed in, null otherwise. */
function mount(session: { signOut: () => Promise<void> } | null = { signOut }) {
  return render(
    <SessionActionsContext.Provider value={session}>
      <MemoryRouter initialEntries={['/v4/home']}>
        <Routes>
          <Route path="/v4/home" element={<SpacesTopBar active="home" viewer={viewer} rank="Rank 1" xp={60} />} />
          <Route path="/" element={<div>landing</div>} />
        </Routes>
      </MemoryRouter>
    </SessionActionsContext.Provider>,
  );
}

beforeEach(async () => {
  signOut.mockClear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllEnvs());

describe('v4 sign out', () => {
  it('live: signs out and lands on the landing page', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    mount();
    const button = screen.getByRole('button', { name: 'Sign out' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('landing')).toBeInTheDocument();
  });

  it('live, in German: the button says Abmelden', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    await i18n.changeLanguage('de');
    mount();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeEnabled();
  });

  it('live but with no session to end: stays inert rather than failing silently', () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    mount(null);
    expect(screen.getByRole('button', { name: /Sign out — not wired/ })).toBeDisabled();
  });

  it('demo: stays inert and says it is not wired', () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'demo');
    mount();
    const button = screen.getByRole('button', { name: /Sign out — not wired/ });
    expect(button).toBeDisabled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
