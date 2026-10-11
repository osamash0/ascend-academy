import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LunaHero } from '../LunaHero';

/**
 * Luna on Home is a character, so the guard is behavioural: she answers a
 * hello, she joins in when something is sent, and she listens when asked to.
 * (The pointer-following and blinking are timing and spring work — checked in
 * the browser, not asserted on a clock here.)
 */

const happyEyes = (root: HTMLElement) => root.querySelectorAll('path[d^="M-6.5 2 Q0"]').length;
const grin = (root: HTMLElement) => root.querySelectorAll('path[d^="M72 69"]').length;

describe('LunaHero', () => {
  it('is a button you can say hi to', () => {
    render(<LunaHero />);
    expect(screen.getByRole('button', { name: /say hi/i })).toBeInTheDocument();
  });

  it('winks and smiles back when greeted', async () => {
    render(<LunaHero />);
    const luna = screen.getByRole('button', { name: /say hi/i });
    await act(async () => {
      fireEvent.click(luna);
    });
    expect(happyEyes(luna)).toBeGreaterThan(0);
    // The grin waits for the resting smile to fade out first.
    await waitFor(() => expect(grin(luna)).toBe(1));
  });

  it('cheers when something is sent', async () => {
    const { rerender } = render(<LunaHero cheer={0} />);
    const luna = screen.getByRole('button', { name: /say hi/i });
    expect(happyEyes(luna)).toBe(0);
    await act(async () => {
      rerender(<LunaHero cheer={1} />);
    });
    expect(happyEyes(luna)).toBe(2);
    await waitFor(() => expect(grin(luna)).toBe(1));
  });

  it('listens with an open mouth while you write', () => {
    render(<LunaHero attention="listening" />);
    const luna = screen.getByRole('button', { name: /say hi/i });
    expect(luna.querySelector('ellipse[rx="2.6"]')).not.toBeNull();
  });

  it('wears the visor she was given', () => {
    render(<LunaHero loadout={{ visor: 'visor-rose' }} />);
    const ring = screen.getByRole('button', { name: /say hi/i }).querySelector('circle[r="38"][stroke]');
    expect(ring?.getAttribute('stroke')?.toLowerCase()).toBe('#e8a598');
  });

  it('wears her helmet and helmet gear by default', () => {
    const { container } = render(<LunaHero loadout={{ gear: 'gear-antenna' }} />);
    expect(container.querySelector('circle[r="38"]')).not.toBeNull(); // the visor ring
    expect(container.querySelector('path[d="M80 24 L80 9"]')).not.toBeNull(); // the antenna
  });

  it('takes the helmet off and wears the look in a home or style look', () => {
    const { container } = render(<LunaHero loadout={{ outfit: 'outfit-texas', gear: 'gear-antenna' }} />);
    expect(container.querySelector('circle[r="38"]')).toBeNull(); // no helmet
    expect(container.querySelector('path[d="M80 24 L80 9"]')).toBeNull(); // no helmet gear
    expect(container.querySelector('path[d^="M57 38 Q56 14"]')).not.toBeNull(); // the cowboy hat
  });
});
