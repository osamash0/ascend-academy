import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import SettingsScreen from '../../screens/SettingsScreen';

/*
 * LS-003. The notification and visibility switches have nothing behind them:
 * no store, so they snap back. The demo says so in a notice. Live, people
 * would take them for real settings — two are privacy settings — so they are
 * not shown until they are stored and honoured.
 */

/** Replies, endorsements, new Lessons, public profile, what I'm reading. */
const UNSAVED_SWITCHES = 5;

const mount = () =>
  render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllEnvs());

describe('v4 Settings shows only what is real', () => {
  it('demo: the switches show, with the notice that they are not saved', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'demo');
    mount();
    expect(await screen.findAllByRole('switch', {}, { timeout: 3000 })).toHaveLength(UNSAVED_SWITCHES);
    expect(screen.getByText(/switches below/i)).toBeInTheDocument();
  });

  it('live: no unsaved switch and no notice; language and your data remain', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    mount();
    expect(await screen.findByRole('button', { name: 'Export' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Deutsch')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByText(/switches below/i)).not.toBeInTheDocument();
  });
});
