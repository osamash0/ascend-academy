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
  it('moves focus and selection with arrow keys, wrapping at either end', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    const page = screen.getByRole('tab', { name: 'Page' });
    const explain = screen.getByRole('tab', { name: 'Explain' });
    const practise = screen.getByRole('tab', { name: 'Practise' });

    fireEvent.keyDown(page, { key: 'ArrowRight' });
    expect(explain).toHaveFocus();
    expect(explain).toHaveAttribute('aria-selected', 'true');
    expect(page).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(explain, { key: 'Home' });
    expect(page).toHaveFocus();
    fireEvent.keyDown(page, { key: 'ArrowLeft' });
    expect(practise).toHaveFocus();
    fireEvent.keyDown(practise, { key: 'ArrowRight' });
    expect(page).toHaveFocus();
    fireEvent.keyDown(page, { key: 'End' });
    expect(practise).toHaveFocus();
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toEqual([practise]);
  });

  it('labels the focusable panel with the selected tab', () => {
    renderWithProviders(<Landing />, { initialEntries: ['/'] });
    const panel = screen.getByRole('tabpanel', { name: 'Page' });
    const ask = screen.getByRole('tab', { name: 'Ask' });
    expect(ask).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('tabindex', '0');

    fireEvent.click(ask);
    expect(screen.getByRole('tabpanel', { name: 'Ask' })).toHaveAttribute('aria-labelledby', ask.id);
    expect(ask).toHaveAttribute('tabindex', '0');
  });

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
