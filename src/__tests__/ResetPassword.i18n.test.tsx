import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';

/* LS-019: with Deutsch picked, the reset-password page was entirely English. */

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => new Promise(() => {}),
    },
  },
}));

import ResetPassword from '@/pages/ResetPassword';

beforeEach(async () => {
  await i18n.changeLanguage('de');
});

describe('reset password in German', () => {
  it('speaks German while the link is checked', () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeInTheDocument();
    expect(screen.getByText('Dein Link wird geprüft…')).toBeInTheDocument();
  });
});
