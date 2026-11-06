import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, __dropCurtain, curtainUp, holdCurtain, liftCurtain } from '../curtain';

const veil = () => document.querySelector<HTMLElement>('[data-reader-curtain]');
/* A reader with one painted page on screen. */
const reader = () => {
  const el = document.createElement('div');
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 800;
  c.getBoundingClientRect = () => ({ left: 40, top: 60, width: 300, height: 400, right: 340, bottom: 460, x: 40, y: 60, toJSON: () => ({}) });
  el.appendChild(c);
  document.body.appendChild(el);
  return el;
};

afterEach(() => {
  __dropCurtain();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the handover still', () => {
  it('holds the painted pages where they were, above everything, taking no clicks', () => {
    holdCurtain(reader());
    expect(curtainUp()).toBe(true);
    const v = veil()!;
    expect(v.style.position).toBe('fixed');
    expect(v.style.pointerEvents).toBe('none');
    const copy = v.querySelector('canvas')!;
    expect(copy.width).toBe(600);
    expect(copy.style.left).toBe('40px');
    expect(copy.style.top).toBe('60px');
    expect(copy.style.width).toBe('300px');
  });

  it('fades out when lifted, then leaves the page', () => {
    vi.useFakeTimers();
    holdCurtain(reader());
    liftCurtain();
    expect(curtainUp()).toBe(false);
    expect(veil()!.style.opacity).toBe('0');
    vi.advanceTimersByTime(300);
    expect(veil()).toBeNull();
  });

  it('never outstays its hold, whatever happens underneath', () => {
    vi.useFakeTimers();
    holdCurtain(reader());
    vi.advanceTimersByTime(HOLD_MS + 300);
    expect(curtainUp()).toBe(false);
    expect(veil()).toBeNull();
  });

  it('with no reader on screen, holds nothing', () => {
    holdCurtain(null);
    expect(curtainUp()).toBe(false);
    expect(veil()).toBeNull();
  });

  it('a second hold replaces the first', () => {
    holdCurtain(reader());
    holdCurtain(reader());
    expect(document.querySelectorAll('[data-reader-curtain]')).toHaveLength(1);
  });
});
