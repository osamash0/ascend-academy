import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SpaceChipRow } from '../hub/SpaceChipRow';
import { LeaveSpace } from '../course/LeaveSpace';
import { cryptography, databaseSystems } from '../../mocks/spaces';

const repo = { leaveSpace: vi.fn(async () => ({ joined: false as const })) };
vi.mock('../../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../../data/liveRepository')>()),
  loadLiveRepository: async () => repo,
}));
const refresh = vi.fn(async () => {});
vi.mock('../../data/viewer', async (orig) => ({
  ...(await orig<typeof import('../../data/viewer')>()),
  useRefreshWorld: () => refresh,
}));

describe('a Space chip opens on a second click (LS-078)', () => {
  it('selects first, and opens the chip that is already selected', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <SpaceChipRow spaces={[databaseSystems, cryptography]} selected={databaseSystems.id} onSelect={onSelect} onOpen={onOpen} />
      </MemoryRouter>,
    );
    const chip = (id: string) => document.querySelector<HTMLElement>(`[data-chip="${id}"]`)!;
    fireEvent.click(chip(cryptography.id));
    expect(onSelect).toHaveBeenCalledWith(cryptography.id);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(chip(databaseSystems.id));
    expect(onOpen).toHaveBeenCalledWith(databaseSystems.id);
  });
});

describe('leaving a Space (LS-077)', () => {
  it('asks once, leaves, refreshes and goes back to Spaces', async () => {
    render(
      <MemoryRouter initialEntries={['/v4/space/s1']}>
        <Routes>
          <Route path="/v4/space/:id" element={<LeaveSpace spaceId="s1" name="Datenbanksysteme" />} />
          <Route path="/v4/spaces" element={<p>the hub</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave this Space' }));
    expect(screen.getByText(/Leave Datenbanksysteme\? Your notes and progress stay/)).toBeInTheDocument();
    expect(repo.leaveSpace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByText('the hub')).toBeInTheDocument());
    expect(repo.leaveSpace).toHaveBeenCalledWith('s1');
    expect(refresh).toHaveBeenCalled();
  });

  it('Stay keeps you in', () => {
    render(
      <MemoryRouter>
        <LeaveSpace spaceId="s1" name="Datenbanksysteme" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave this Space' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: 'Leave this Space' })).toBeInTheDocument();
  });
});
