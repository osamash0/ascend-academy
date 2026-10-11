import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { viewer as demoViewer } from '../mocks/people';

const { meMock } = vi.hoisted(() => ({ meMock: vi.fn() }));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => ({ me: meMock }),
}));

import { useViewer, ViewerGate } from '../data/viewer';

function Name() {
  return <p>{useViewer().name}</p>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  meMock.mockReset();
});

describe('viewer', () => {
  it('is the demo person with no provider at all', () => {
    render(<Name />);
    expect(screen.getByText(demoViewer.name)).toBeTruthy();
  });

  it('demo mode renders straight through without asking the server', () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'demo');
    render(<ViewerGate><Name /></ViewerGate>);
    expect(screen.getByText(demoViewer.name)).toBeTruthy();
    expect(meMock).not.toHaveBeenCalled();
  });

  it('live mode waits for the signed-in person, then every screen sees them', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    meMock.mockResolvedValue({ id: 'u-1', name: 'Lea', avatarUrl: null });
    render(<ViewerGate><Name /></ViewerGate>);
    expect(screen.queryByText(demoViewer.name)).toBeNull();
    expect(await screen.findByText('Lea')).toBeTruthy();
  });

  it('live mode says so when the profile cannot load, instead of showing the demo person', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    meMock.mockRejectedValue(new Error('500'));
    render(<ViewerGate><Name /></ViewerGate>);
    expect(await screen.findByText(/your profile/i)).toBeTruthy();
    expect(screen.queryByText(demoViewer.name)).toBeNull();
  });
});
