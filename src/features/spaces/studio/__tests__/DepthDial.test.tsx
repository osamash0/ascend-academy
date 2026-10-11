import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DepthDial } from '../components/DepthDial';
import type { Depth } from '../depth';

const mount = (value: Depth = 'summary', options: Depth[] = ['gist', 'summary', 'full', 'page']) => {
  const onChange = vi.fn();
  render(<DepthDial page={4} value={value} options={options} onChange={onChange} />);
  return onChange;
};

describe('DepthDial', () => {
  it('is a radiogroup for the page with four named stops', () => {
    mount();
    const group = screen.getByRole('radiogroup', { name: 'Depth for page 4' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Gist', 'Summary', 'Full', 'Page']);
    expect(within(group).getByRole('radio', { name: 'Summary' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'Gist' })).toHaveAttribute('aria-checked', 'false');
  });

  it('disables the depths this page does not offer', () => {
    mount('summary', ['gist', 'summary', 'page']);
    expect(screen.getByRole('radio', { name: 'Full' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Page' })).not.toBeDisabled();
  });

  it('roves: only the current stop is in the tab order', () => {
    mount('full');
    const tab = screen.getAllByRole('radio').map((r) => r.getAttribute('tabindex'));
    expect(tab).toEqual(['-1', '-1', '0', '-1']);
  });

  it('arrow keys move the choice for this page only', () => {
    const onChange = mount('summary');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Summary' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('full', false);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Summary' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('gist', false);
  });

  it('arrow keys skip a depth the page does not offer', () => {
    const onChange = mount('summary', ['gist', 'summary', 'page']);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Summary' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('page', false);
  });

  it('a click chooses; Shift+click chooses for every page', () => {
    const onChange = mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Gist' }));
    expect(onChange).toHaveBeenLastCalledWith('gist', false);
    fireEvent.click(screen.getByRole('radio', { name: 'Page' }), { shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('page', true);
  });

  it('every stop is at least 24 px to hit', () => {
    mount();
    for (const r of screen.getAllByRole('radio')) expect(r.className).toMatch(/\bh-6\b.*\bw-6\b|\bw-6\b.*\bh-6\b/);
  });
});
