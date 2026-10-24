import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { viewer as demoViewer } from '../mocks/people';
import type { Lesson, Space } from '../types';

const { worldMock } = vi.hoisted(() => ({ worldMock: vi.fn() }));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => ({ world: worldMock }),
}));

import { useViewer, LiveGate } from '../data/viewer';
import * as world from '../data/world';
import { spaceById as fixtureSpaceById } from '../mocks/spaces';

function Name() {
  return <p>{useViewer().name}</p>;
}

const lea = { id: 'u-1', name: 'Lea', avatarUrl: null };
const dbs = {
  id: 'c-dbs', name: 'Datenbanksysteme', shortCode: 'DBS', viewerRole: 'member', state: 'active',
} as Space;
const lesson = (id: string, order: number, state: Lesson['state'] = 'published') =>
  ({ id, spaceId: 'c-dbs', title: id, order, state, percentComplete: order * 10 }) as Lesson;

afterEach(() => {
  vi.unstubAllEnvs();
  worldMock.mockReset();
  world.setLiveWorld(null);
});

describe('LiveGate and the world', () => {
  it('demo: the fixture person and fixture Spaces, no provider needed', () => {
    render(<Name />);
    expect(screen.getByText(demoViewer.name)).toBeTruthy();
    expect(world.spaceById('s-dbs')).toBe(fixtureSpaceById('s-dbs'));
  });

  it('demo mode renders straight through without asking the server', () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'demo');
    render(<LiveGate><Name /></LiveGate>);
    expect(screen.getByText(demoViewer.name)).toBeTruthy();
    expect(worldMock).not.toHaveBeenCalled();
  });

  it('live: waits for the world, then every screen sees the real viewer and Spaces', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    worldMock.mockResolvedValue({
      viewer: lea, spaces: [dbs], lessons: [lesson('l2', 2), lesson('l1', 1), lesson('d', 3, 'draft')],
    });
    render(<LiveGate><Name /></LiveGate>);
    expect(screen.queryByText(demoViewer.name)).toBeNull();
    expect(await screen.findByText('Lea')).toBeTruthy();

    expect(world.spaceById('c-dbs')?.name).toBe('Datenbanksysteme');
    expect(world.spaceById('s-dbs')).toBeUndefined(); // no fixture leaks into live
    expect(world.joinedByViewer().map((s) => s.id)).toEqual(['c-dbs']);
    // Members see the published path, in order; the draft stays hidden.
    expect(world.visibleLessonsForSpace(dbs).map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(world.adjacentLessons('c-dbs', 'l1').next?.id).toBe('l2');
    expect(world.progressAcross('c-dbs')).toBe(15);
  });

  it('live: names the failure instead of falling back to the demo world', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    worldMock.mockRejectedValue(new Error('500'));
    render(<LiveGate><Name /></LiveGate>);
    expect(await screen.findByText(/your Spaces/i)).toBeTruthy();
    expect(screen.queryByText(demoViewer.name)).toBeNull();
  });
});
