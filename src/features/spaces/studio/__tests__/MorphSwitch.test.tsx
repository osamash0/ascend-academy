import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MorphSwitch } from '../components/MorphSwitch';

const setup = (view: 'clean' | 'original' = 'clean', shown: 'clean' | 'original' = view) => {
  const h = { onPressStart: vi.fn(), onPressEnd: vi.fn(), onPressCancel: vi.fn(), onToggle: vi.fn() };
  render(<MorphSwitch view={view} shown={shown} {...h} />);
  return { h, sw: screen.getByRole('switch') };
};

describe('MorphSwitch', () => {
  it('is a switch whose state follows the committed view, not a quick look', () => {
    expect(setup('clean', 'original').sw.getAttribute('aria-checked')).toBe('false');
  });

  it('Enter toggles once; a repeated Enter does not', () => {
    const { h, sw } = setup();
    fireEvent.keyDown(sw, { key: 'Enter' });
    fireEvent.keyDown(sw, { key: 'Enter', repeat: true });
    expect(h.onToggle).toHaveBeenCalledTimes(1);
  });

  it('pointer down and up drive the press', () => {
    const { h, sw } = setup();
    fireEvent.pointerDown(sw, { button: 0 });
    fireEvent.pointerUp(sw);
    expect(h.onPressStart).toHaveBeenCalledTimes(1);
    expect(h.onPressEnd).toHaveBeenCalledTimes(1);
  });
});
