import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import SettingsScreen from '../../screens/SettingsScreen';
import SocialScreen from '../../screens/SocialScreen';
import { liveWorld, setLiveWorld } from '../../data/world';
import { emptyWorld } from '../../__tests__/emptyWorld';

/*
 * LS-036. Privacy by default: the people in your Spaces see you (rankings,
 * Space cards) only once you switch it on. The switch is real — stored on the
 * server — and Social says, while it is off, that only your friends see you.
 */

const setShowInSpaces = vi.fn();
vi.mock('../../data/liveRepository', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadLiveRepository: async () => ({ setShowInSpaces }),
}));

const toast = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign((...a: unknown[]) => toast(...a), { error: (...a: unknown[]) => toast(...a) }),
}));

const mount = (screenEl: JSX.Element) => render(<MemoryRouter>{screenEl}</MemoryRouter>);

beforeEach(async () => {
  vi.stubEnv('VITE_V4_DATA_MODE', 'live');
  setShowInSpaces.mockReset();
  toast.mockReset();
  await i18n.changeLanguage('en');
  setLiveWorld(emptyWorld({
    social: {
      leaderboard: [{ person: { id: 'u', name: 'Lea', avatarUrl: null }, xp: 40, sharedSpaces: 1, isViewer: true }],
      friends: [], requests: [], sharedSpaceIds: {},
    },
  }));
});
afterEach(() => {
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

const theSwitch = () =>
  screen.findByRole('switch', { name: /show me to the people in my spaces/i }, { timeout: 3000 });

describe('Settings: who sees you', () => {
  it('is off for a new account, and switching it on saves it', async () => {
    setShowInSpaces.mockResolvedValue({ showInSpaces: true });
    mount(<SettingsScreen />);
    const sw = await theSwitch();
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(setShowInSpaces).toHaveBeenCalledWith(true));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(liveWorld()?.showInSpaces).toBe(true);
  });

  it('if the save fails it goes back and says so', async () => {
    setShowInSpaces.mockRejectedValue(new Error('down'));
    mount(<SettingsScreen />);
    const sw = await theSwitch();
    fireEvent.click(sw);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That did not save. Try again.'));
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Social: while it is off', () => {
  it('says only your friends see you, and offers to show you to your Spaces', async () => {
    setShowInSpaces.mockResolvedValue({ showInSpaces: true });
    mount(<SocialScreen />);
    expect(await screen.findByText(/only your friends see you here/i, {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show me to my Spaces' }));
    await waitFor(() => expect(setShowInSpaces).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByText(/only your friends see you here/i)).not.toBeInTheDocument());
  });

  it('once on, says nothing more', async () => {
    setLiveWorld({ ...liveWorld()!, showInSpaces: true });
    mount(<SocialScreen />);
    expect(await screen.findByText(/ranked by xp/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(/only your friends see you here/i)).not.toBeInTheDocument();
  });
});
