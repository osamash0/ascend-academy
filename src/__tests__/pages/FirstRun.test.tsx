/**
 * First run on the stage (2026-10-24): two moments, then into the product.
 *
 *   1. Name — Luna asks; she repeats it back as you type.
 *   2. Her light — four free visor + suit pairs; the pick relights the room.
 *
 * Then: Luna's loadout is saved, onboarding is marked complete (v4 only — in
 * legacy mode the study-path step that follows does that), the profile is
 * refreshed so the guards let the person through, and the page hands over.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

const { refreshProfile, save, complete, play, toggle } = vi.hoisted(() => ({
  refreshProfile: vi.fn(),
  save: vi.fn(),
  complete: vi.fn(),
  play: vi.fn(),
  toggle: vi.fn(),
}));

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ useAuth: () => useAuthMock() }));

vi.mock('@/features/avatar/useAvatar', async () => {
  const { DEFAULT_LOADOUT } = await import('@/features/avatar/catalog');
  return { useLoadout: () => ({ loadout: DEFAULT_LOADOUT, save, ready: true }) };
});

vi.mock('@/services/onboardingService', () => ({ completeActivationOnboarding: complete }));

vi.mock('@/lib/useSound', () => ({
  useSound: () => ({ play, enabled: false, toggle }),
}));

import FirstRun from '@/pages/FirstRun';
import { renderWithProviders } from '@/test/renderWithProviders';

function persona(fullName: string | null = null) {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', email: 'alice@b.de' },
    profile: { user_id: 'u1', full_name: fullName, has_completed_activation_onboarding: false },
    role: 'student',
    loading: false,
    refreshProfile,
  });
}

function mount(v4First: boolean) {
  return renderWithProviders(
    <Routes>
      <Route path="/onboarding" element={<FirstRun v4First={v4First} />} />
      <Route path="/v4/home" element={<div>v4-home</div>} />
      <Route path="/onboarding/start" element={<div>activation</div>} />
    </Routes>,
    { initialEntries: ['/onboarding'] },
  );
}

async function throughName(user: ReturnType<typeof userEvent.setup>, name = 'Alice Smith') {
  await user.type(screen.getByLabelText(/your name/i), name);
  await user.click(screen.getByRole('button', { name: /that's me/i }));
  return screen.findByRole('heading', { name: /pick her light/i }, { timeout: 3000 });
}

beforeEach(() => {
  supabaseMock.reset();
  supabaseMock.seed('profiles', [{ user_id: 'u1', full_name: null, display_name: null }]);
  refreshProfile.mockReset().mockResolvedValue(undefined);
  save.mockReset().mockResolvedValue(undefined);
  complete.mockReset().mockResolvedValue({ path: 'material', study_goal: null, version: 1 });
  play.mockReset();
  persona();
});

describe('First run, moment one: your name', () => {
  it('Luna asks, and the step is named rather than counted', () => {
    mount(true);
    expect(screen.getByRole('heading', { name: /i'm luna\. and you\?/i })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /getting started/i })).toHaveAttribute('aria-valuetext', 'Name');
    expect(screen.getByRole('button', { name: /that's me/i })).toBeDisabled();
  });

  it('she repeats your first name back as you type', async () => {
    const user = userEvent.setup();
    mount(true);
    await user.type(screen.getByLabelText(/your name/i), 'Alice Smith');
    expect(await screen.findByText('Alice?', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('saves the name as both full and display name', async () => {
    const user = userEvent.setup();
    mount(true);
    await throughName(user);
    const row = supabaseMock.data['profiles'].rows[0];
    expect(row.full_name).toBe('Alice Smith');
    expect(row.display_name).toBe('Alice Smith');
  });

  it('"Pick one for me" rolls an alias into the field, and she says all of it', async () => {
    const { default: en } = await import('@/i18n/locales/en/onboarding.json');
    const aliases: string[] = en.firstRun.name.aliases;
    const user = userEvent.setup();
    mount(true);
    await user.click(screen.getByRole('button', { name: /pick one for me/i }));
    const field = screen.getByLabelText(/your name/i);
    await waitFor(() => expect(play).toHaveBeenCalledWith('select'), { timeout: 2000 });
    const landed = (field as HTMLInputElement).value;
    expect(aliases).toContain(landed);
    expect(await screen.findByText(`${landed}?`, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /that's me/i })).toBeEnabled();
  });

  it('rolling again lands on a different alias, and typing replaces it', async () => {
    const user = userEvent.setup();
    mount(true);
    const field = screen.getByLabelText(/your name/i) as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: /pick one for me/i }));
    await waitFor(() => expect(play).toHaveBeenCalledWith('select'), { timeout: 2000 });
    const first = field.value;
    play.mockClear();
    await user.click(screen.getByRole('button', { name: /pick one for me/i }));
    await waitFor(() => expect(play).toHaveBeenCalledWith('select'), { timeout: 2000 });
    expect(field.value).not.toBe(first);
    await user.clear(field);
    await user.type(field, 'Alice');
    expect(field).toHaveValue('Alice');
  });

  it('a rolled alias is saved like a typed name', async () => {
    const user = userEvent.setup();
    mount(true);
    await user.click(screen.getByRole('button', { name: /pick one for me/i }));
    await waitFor(() => expect(play).toHaveBeenCalledWith('select'), { timeout: 2000 });
    const landed = (screen.getByLabelText(/your name/i) as HTMLInputElement).value;
    await user.click(screen.getByRole('button', { name: /that's me/i }));
    await screen.findByRole('heading', { name: /pick her light/i }, { timeout: 3000 });
    expect(supabaseMock.data['profiles'].rows[0].display_name).toBe(landed);
  });

  it('keeps a name the account already has', () => {
    persona('Bea');
    mount(true);
    expect(screen.getByLabelText(/your name/i)).toHaveValue('Bea');
  });
});

describe('First run, moment two: her light', () => {
  it('offers four free lights, none of them purple, with teal chosen', async () => {
    const user = userEvent.setup();
    mount(true);
    await throughName(user);
    const lights = screen.getAllByRole('radio');
    expect(lights.map((r) => r.getAttribute('aria-label'))).toEqual(['Teal', 'Starlight', 'Rose', 'Tidal']);
    expect(screen.getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a pick is hers at once, and she says so', async () => {
    const user = userEvent.setup();
    mount(true);
    await throughName(user);
    await user.click(screen.getByRole('radio', { name: 'Rose' }));
    expect(screen.getByRole('radio', { name: 'Rose' })).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('Suits me.')).toBeInTheDocument();
  });

  it('Keep it saves her look, completes onboarding, refreshes, then opens v4 Home', async () => {
    const user = userEvent.setup();
    mount(true);
    await throughName(user);
    await user.click(screen.getByRole('radio', { name: 'Rose' }));
    await user.click(screen.getByRole('button', { name: /keep it/i }));
    expect(await screen.findByText('v4-home', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ visor: 'visor-rose', suit: 'suit-blush' }));
    expect(complete).toHaveBeenCalledWith('material');
    expect(refreshProfile).toHaveBeenCalled();
    expect(complete.mock.invocationCallOrder[0]).toBeLessThan(refreshProfile.mock.invocationCallOrder.at(-1)!);
  });

  it('without v4 it hands over to the study-path step, which completes onboarding itself', async () => {
    const user = userEvent.setup();
    mount(false);
    await throughName(user);
    await user.click(screen.getByRole('button', { name: /keep it/i }));
    expect(await screen.findByText('activation', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(save).toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('if saving fails it says so and stays', async () => {
    complete.mockRejectedValue(new Error('rpc down'));
    const user = userEvent.setup();
    mount(true);
    await throughName(user);
    await user.click(screen.getByRole('button', { name: /keep it/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save that/i);
    await waitFor(() => expect(screen.getByRole('button', { name: /keep it/i })).toBeEnabled());
    expect(screen.queryByText('v4-home')).not.toBeInTheDocument();
  });

  it('Back returns to the name with it still there', async () => {
    const user = userEvent.setup();
    mount(true);
    await throughName(user);
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByLabelText(/your name/i, {}, { timeout: 3000 })).toHaveValue('Alice Smith');
  });
});
