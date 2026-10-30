import { Suspense } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadable } from '../preloadable';

const mountIn = (Screen: React.ComponentType) =>
  render(
    <Suspense fallback={<p>Loading</p>}>
      <Screen />
    </Suspense>,
  );

describe('a preloadable screen', () => {
  it('fetched ahead of time, renders at once: no loader in between', async () => {
    const Screen = preloadable(async () => ({ default: () => <p>the reader</p> }));
    await Screen.preload();
    mountIn(Screen);
    expect(screen.getByText('the reader')).toBeInTheDocument();
    expect(screen.queryByText('Loading')).toBeNull();
  });

  it('not fetched yet, is a lazy screen like any other', async () => {
    const Screen = preloadable(async () => ({ default: () => <p>the reader</p> }));
    mountIn(Screen);
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(await screen.findByText('the reader')).toBeInTheDocument();
  });

  it('fetches once, however often it is asked', async () => {
    let fetches = 0;
    const Screen = preloadable(async () => {
      fetches += 1;
      return { default: () => <p>the reader</p> };
    });
    await Promise.all([Screen.preload(), Screen.preload()]);
    mountIn(Screen);
    expect(fetches).toBe(1);
  });

  it('a failed fetch can be tried again', async () => {
    let fail = true;
    const Screen = preloadable(async () => {
      if (fail) throw new Error('offline');
      return { default: () => <p>the reader</p> };
    });
    await expect(Screen.preload()).rejects.toThrow('offline');
    fail = false;
    await Screen.preload();
    mountIn(Screen);
    expect(screen.getByText('the reader')).toBeInTheDocument();
  });
});
