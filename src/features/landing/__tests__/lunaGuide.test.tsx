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
    expect(guideMood('page', null)).toBe('thinking');
    expect(guideMood('explain', null)).toBe('curious');
    expect(guideMood('ask', null)).toBe('bright');
    expect(guideMood('practise', null)).toBe('focused');
  });

  it('cheers a right answer and a poke, and tilts — never frowns — at a wrong one', () => {
    expect(guideMood('practise', 'right')).toBe('celebrating');
    expect(guideMood('ask', 'poke')).toBe('celebrating');
    expect(guideMood('practise', 'wrong')).toBe('curious');
  });
});

describe('the demo shows what the reader really does', () => {
  it('has the reader\'s four faces — Page, Explain, Ask, Practise — and nothing invented', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Page', 'Explain', 'Ask', 'Practise']);
  });

  it('Explain lights the part\'s own words on the page', async () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('tab', { name: /explain/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Supply' }));
    expect(screen.getByText('quantity supplied rises with price', { selector: 'mark' })).toBeInTheDocument();
  });

  it('Ask answers with a citation of the page', async () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('tab', { name: /^ask$/i }));
    // The page's own footer also says 'p. 14' while it fades out, so ask for the chip itself.
    expect(await screen.findByTestId('ask-cite')).toHaveTextContent('p. 14');
  });
});

describe('Luna on the landing page', () => {
  const luna = () => screen.getByTestId('luna-guide');

  it('stands on the first tab, decoration only', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    expect(luna()).toHaveAttribute('aria-hidden', 'true');
    expect(luna()).toHaveAttribute('data-at', 'page');
    expect(luna()).toHaveAttribute('data-mood', 'thinking');
    expect(screen.getByTestId('luna-says')).toHaveTextContent('Page 14.');
  });

  it('goes where the visitor goes, and wears that page', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('tab', { name: /^ask$/i }));
    expect(luna()).toHaveAttribute('data-at', 'ask');
    expect(luna()).toHaveAttribute('data-mood', 'bright');
  });

  it('cheers when the visitor answers right, tilts when wrong', async () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('tab', { name: /practise/i }));
    expect(luna()).toHaveAttribute('data-mood', 'focused');

    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Falls' })));
    await waitFor(() => expect(luna()).toHaveAttribute('data-mood', 'curious'), { timeout: 4000 });

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Rises' })));
    await waitFor(() => expect(luna()).toHaveAttribute('data-mood', 'celebrating'), { timeout: 4000 });
  });
});
