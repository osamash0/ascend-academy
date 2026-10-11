import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCanvas } from '../../data/useSpaces';

describe('useCanvas', () => {
  it('settles to the canvas, its pages, material and Space', async () => {
    const { result } = renderHook(() => useCanvas('c-norm'));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.canvas?.id).toBe('c-norm');
    expect(result.current.pages.length).toBe(12);
    expect(result.current.material?.filename).toBe('Normalization.pdf');
    expect(result.current.spaceName).toBe('Database Systems');
  });

  it('reports an unknown canvas as empty, not as an error', async () => {
    const { result } = renderHook(() => useCanvas('nope'));
    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(result.current.canvas).toBeNull();
  });
});

