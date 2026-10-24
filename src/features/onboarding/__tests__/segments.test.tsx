import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Segments } from '../Segments';

/**
 * First run's progress: lights, not a counter (the Practice idiom). Held steps
 * glow in the chosen light; the current one is white; the rest are dim.
 */
describe('Segments', () => {
  it('is a progress bar that names the current step instead of counting', () => {
    render(<Segments total={2} current={0} label="Getting started" valueText="Name" accent="#E8A598" />);
    const bar = screen.getByRole('progressbar', { name: 'Getting started' });
    expect(bar).toHaveAttribute('aria-valuetext', 'Name');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    expect(bar.textContent).toBe('');
  });

  it('lights held steps in the accent and the current one white', () => {
    render(<Segments total={2} current={1} label="Getting started" valueText="Light" accent="#E8A598" />);
    const [held, current] = screen.getAllByTestId('segment');
    expect(held.style.background.toLowerCase()).toMatch(/e8a598|232, 165, 152/);
    expect(current.dataset.state).toBe('current');
  });
});
