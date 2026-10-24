import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Landing from '@/pages/Landing';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * "Start learning" opens the account page in sign-up mode; "Sign in" opens it
 * in sign-in mode. Before 2026-10-24 both opened sign-in, so a newcomer's first
 * click landed on a form for people who already have an account.
 */
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function mount() {
  renderWithProviders(
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Where />} />
    </Routes>,
    { initialEntries: ['/'] },
  );
}

describe('landing calls to action', () => {
  it('every Start opens sign-up', () => {
    mount();
    const count = screen.getAllByRole('button', { name: /start/i }).length;
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      cleanup();
      mount();
      fireEvent.click(screen.getAllByRole('button', { name: /start/i })[i]);
      expect(screen.getByTestId('where')).toHaveTextContent('/auth?mode=signup');
    }
  });

  it('Sign in opens sign-in', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: /sign in/i })[0]);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/auth$/);
  });
});
