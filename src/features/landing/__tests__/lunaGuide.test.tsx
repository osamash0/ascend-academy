import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import Landing from '@/pages/Landing';
import { renderWithProviders } from '@/test/renderWithProviders';
import { guideMood } from '../LunaGuide';

/**
 * Luna shows you around the landing page's live page (2026-10-16): she stands
 * on the tab bar, moves to the tab being shown, wears the page's mood, and
 * reacts to the visitor's answer.
 */

describe('guideMood', () => {
  it('gives every page its own face', () => {
    expect(guideMood('original', null)).toBe('thinking');
    expect(guideMood('explore', null)).toBe('curious');
    expect(guideMood('learn', null)).toBe('bright');
    expect(guideMood('practise', null)).toBe('focused');
  });

  it('cheers a right answer and a poke, and tilts — never frowns — at a wrong one', () => {
    expect(guideMood('practise', 'right')).toBe('celebrating');
    expect(guideMood('learn', 'poke')).toBe('celebrating');
    expect(guideMood('practise', 'wrong')).toBe('curious');
  });
});

describe('Luna on the landing page', () => {
  const luna = () => screen.getByTestId('luna-guide');

  it('stands on the first tab, decoration only', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    expect(luna()).toHaveAttribute('aria-hidden', 'true');
    expect(luna()).toHaveAttribute('data-at', 'original');
    expect(luna()).toHaveAttribute('data-mood', 'thinking');
  });

  it('goes where the visitor goes, and wears that page', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('tab', { name: /learn/i }));
    expect(luna()).toHaveAttribute('data-at', 'learn');
    expect(luna()).toHaveAttribute('data-mood', 'bright');
  });

  it('cheers when the visitor answers right, tilts when wrong', async () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('tab', { name: /practise/i }));
    expect(luna()).toHaveAttribute('data-mood', 'focused');

    await act(async () => fireEvent.click(await screen.findByRole('button', { name: '2NF' })));
    await waitFor(() => expect(luna()).toHaveAttribute('data-mood', 'curious'), { timeout: 4000 });

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '3NF' })));
    await waitFor(() => expect(luna()).toHaveAttribute('data-mood', 'celebrating'), { timeout: 4000 });
  });
});
