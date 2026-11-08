import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { setLiveWorld } from '../data/world';
import type { Space } from '../types';
import { emptyWorld } from './emptyWorld';
import SpaceOwnerGate from '../screens/SpaceOwnerGate';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const space = (viewerRole: Space['viewerRole'], personal = false) =>
  ({ id: SPACE, name: 'Lerngruppe', owner: { id: 'u', name: 'Lea', avatarUrl: null }, viewerRole, personal, state: 'active', visibility: 'private', memberCount: 6 }) as unknown as Space;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

const visit = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/v4/space/${id}/landing`]}>
      <Where />
      <Routes>
        <Route path="/v4/space/:spaceId/landing" element={<SpaceOwnerGate><p>the door</p></SpaceOwnerGate>} />
        <Route path="/v4/space/:spaceId" element={<p>the space</p>} />
      </Routes>
    </MemoryRouter>,
  );

const liveWith = (spaces: Space[]) => {
  vi.stubEnv('VITE_V4_DATA_MODE', 'live');
  setLiveWorld(emptyWorld({ spaces }));
};

afterEach(() => {
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('the door is the owner’s', () => {
  it('the person who runs the Space walks in', () => {
    liveWith([space('owner')]);
    visit(SPACE);
    expect(screen.getByText('the door')).toBeInTheDocument();
  });

  it.each([
    ['a member', [space('member')]],
    ['someone who helps run it but does not own it', [space('editor')]],
    ['someone who has not joined', [space(null)]],
    ['someone the Space is hidden from', []],
    ['the owner of their own personal Space', [space('owner', true)]],
  ])('%s is taken back to the Space', (_who, spaces) => {
    liveWith(spaces);
    visit(SPACE);
    expect(screen.getByText('the space')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe(`/v4/space/${SPACE}`);
  });

  it('a live build never opens a demo Space’s fixture', () => {
    liveWith([space('owner')]);
    visit('s-dbs');
    expect(screen.getByTestId('where').textContent).toBe('/v4/space/s-dbs');
  });

  it('the demo build opens a demo Space on its fixture', () => {
    visit('s-dbs');
    expect(screen.getByText('the door')).toBeInTheDocument();
  });
});
