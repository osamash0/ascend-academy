import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { shelfAcceptsFiles, shelfActions, useShelf, useShelfItem } from '../data/useShelf';
import { setLiveWorld } from '../data/world';
import { useLibrary } from '../data/useSpaces';
import { emptyWorld } from './emptyWorld';

afterEach(() => setLiveWorld(null));

describe('the Library shelf, live', () => {
  it('demo keeps the fixture shelf and takes files', () => {
    expect(shelfAcceptsFiles()).toBe(true);
    expect(shelfActions.getItems().length).toBeGreaterThan(0);
  });

  it('live shows no fixture files, opens none, and takes no files', () => {
    setLiveWorld(emptyWorld());
    const shelf = renderHook(() => useShelf()).result.current;
    expect(shelfAcceptsFiles()).toBe(false);
    expect(shelf.items).toEqual([]);
    expect(shelf.continueItem).toBeNull();
    expect(shelf.words.every((w) => w.kind === 'note')).toBe(true);
    expect(renderHook(() => useShelfItem('m-norm')).result.current.item).toBeNull();
  });

  it('live Library lists notes only — no fixture contributions or orphans', () => {
    setLiveWorld(emptyWorld());
    const lib = renderHook(() => useLibrary()).result.current;
    expect(lib.items.every((i) => i.kind === 'note')).toBe(true);
    expect(renderHook(() => useLibrary('contribution')).result.current.items).toEqual([]);
  });
});
