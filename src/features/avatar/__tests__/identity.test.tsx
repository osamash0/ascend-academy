import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' }, profile: null }) }));
vi.mock('../useAvatar', () => ({ useLoadout: () => ({ loadout: { suit: 'suit-mint' }, mood: 'bright', ready: true }) }));

import { __resetPublicLoadoutsForTests, initialsOf, isRealPhoto } from '../identity';
import { UserAvatar } from '../UserAvatar';
import { PhotoError, validatePhoto } from '../photo';

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  rpc.mockReset();
  __resetPublicLoadoutsForTests();
});

describe('isRealPhoto', () => {
  it('treats onboarding’s old DiceBear presets as no photo', () => {
    expect(isRealPhoto('https://api.dicebear.com/7.x/bottts/svg?seed=Felix')).toBe(false);
  });
  it('accepts an uploaded storage URL', () => {
    expect(isRealPhoto('https://x.supabase.co/storage/v1/object/public/avatars/u/avatar-1.webp')).toBe(true);
  });
  it.each([null, undefined, '', 'not a url', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>'])('rejects %s', (v) => {
    expect(isRealPhoto(v as string)).toBe(false);
  });
});

describe('initialsOf', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['ada', 'A'],
    ['  Mia  van  Berg ', 'MB'],
    ['', '?'],
    [null, '?'],
  ])('%s → %s', (name, out) => expect(initialsOf(name)).toBe(out));
});

describe('UserAvatar fallback order', () => {
  it('shows a real photo first', () => {
    const { container } = wrap(<UserAvatar userId="u1" name="Ada L" avatarUrl="https://x.supabase.co/a.webp" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x.supabase.co/a.webp');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows the viewer’s own Luna without a network call', () => {
    const { container } = wrap(<UserAvatar userId="me" name="Me" avatarUrl="https://api.dicebear.com/7.x/bottts/svg" />);
    expect(container.querySelector('svg[aria-label="Luna avatar"]')).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('batches other people into one request and draws their Luna', async () => {
    rpc.mockResolvedValue({ data: [{ user_id: 'u1', luna_loadout: { gear: 'gear-antenna' }, luna_suit_color: null, luna_visor_tint: null }], error: null });
    const { container } = wrap(
      <>
        <UserAvatar userId="u1" name="Ada Lovelace" />
        <UserAvatar userId="u2" name="Ben Ng" />
        <UserAvatar userId="u3" name="Cy Ito" />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll('svg[aria-label="Luna avatar"]')).toHaveLength(1));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_luna_loadouts', { p_user_ids: ['u1', 'u2', 'u3'] });
    // People without a row stay as initials — no invented Luna.
    expect(screen.getByText('BN')).toBeTruthy();
    expect(screen.getByText('CI')).toBeTruthy();
  });

  it('falls back to initials when the RPC is not deployed yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    wrap(<UserAvatar userId="u9" name="Zoe Park" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(screen.getByText('ZP')).toBeTruthy();
  });
});

describe('validatePhoto', () => {
  const file = (type: string, size = 1000) => new File([new Uint8Array(size)], 'x', { type });
  it('accepts common photo types', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(() => validatePhoto(file(t))).not.toThrow();
  });
  it('refuses SVG and non-images', () => {
    for (const t of ['image/svg+xml', 'text/html', 'application/pdf']) {
      expect(() => validatePhoto(file(t))).toThrow(PhotoError);
    }
  });
  it('refuses huge files', () => {
    expect(() => validatePhoto(file('image/jpeg', 16 * 1024 * 1024))).toThrow(expect.objectContaining({ code: 'size' }));
  });
});
