import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeScreen from '../../screens/HomeScreen';
import { setLiveWorld } from '../../data/world';
import { ViewerLoadoutContext } from '@/features/avatar/viewerLoadout';
import { emptyWorld } from '../../__tests__/emptyWorld';

/**
 * The first screen after first run (2026-10-24). A brand-new account has no
 * Lesson to light the room, so Home is lit by the light they just picked for
 * Luna, Luna is there wearing it, the greeting has the name they just typed,
 * and the two doors are a Space to find and a file to bring in.
 */
function mount() {
  setLiveWorld(emptyWorld());
  return render(
    <ViewerLoadoutContext.Provider value={{ visor: 'visor-rose', suit: 'suit-blush' }}>
      <MemoryRouter initialEntries={['/v4/home']}>
        <HomeScreen />
      </MemoryRouter>
    </ViewerLoadoutContext.Provider>,
  );
}

afterEach(() => setLiveWorld(null));

describe('Home, right after first run', () => {
  it('has Luna, lit in the light she was given', () => {
    const { container } = mount();
    expect(screen.getByRole('button', { name: /luna/i })).toBeInTheDocument();
    const lit = container.querySelector<HTMLElement>('[style*="--stage-accent"]');
    expect(lit?.style.getPropertyValue('--stage-accent').toLowerCase()).toBe('#e8a598');
  });

  it('offers a file to bring in beside a Space to find', () => {
    mount();
    expect(screen.getByRole('link', { name: /bring in a file/i })).toHaveAttribute('href', '/v4/library');
    expect(screen.getByRole('button', { name: /find a space/i })).toBeInTheDocument();
  });
});
