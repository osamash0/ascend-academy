// src/features/spaces/__tests__/luna-memory.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';

const api = vi.hoisted(() => ({
  memory: vi.fn(),
  editMemory: vi.fn(),
  deleteMemory: vi.fn(),
  forgetAll: vi.fn(),
}));
vi.mock('../data/lunaSession', async (orig) => ({
  ...(await orig<typeof import('../data/lunaSession')>()),
  lunaApi: api,
}));

import { LunaMemoryCard } from '../components/LunaMemoryCard';

afterEach(() => vi.clearAllMocks());

describe('What Luna knows about you', () => {
  it('lists lines by kind, edits, deletes, and forgets everything after confirming', async () => {
    api.memory.mockResolvedValue({
      memory: [
        { id: 'm1', kind: 'preference', space_id: null, text: 'examples before definitions', active: true },
        { id: 'm2', kind: 'shaky', space_id: 's1', text: 'outer joins', active: false },
      ],
    });
    api.deleteMemory.mockResolvedValue({ deleted: true });
    api.forgetAll.mockResolvedValue({ deleted: 2 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LunaMemoryCard />);
    expect(await screen.findByText('examples before definitions')).toBeTruthy();
    expect(screen.getByText('Faded')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith('m1'));
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }));
    await waitFor(() => expect(api.forgetAll).toHaveBeenCalled());
    expect(await screen.findByText('Nothing yet. Luna learns as you study together.')).toBeTruthy();
  });
});
