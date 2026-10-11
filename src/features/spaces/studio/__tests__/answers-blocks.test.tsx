import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnswerBlockView } from '../answers/Blocks';
import type { AnswerBlock } from '../answers/spec';

const fd = (l: string, r: string) => ({ lhs: l.split(' '), rhs: r.split(' ') });
const view = (block: AnswerBlock) => render(<AnswerBlockView block={block} />);

describe('AnswerBlockView', () => {
  it('renders text and key markdown', () => {
    view({ type: 'text', md: 'Plain **term** here' });
    expect(document.querySelector('[data-streamdown="strong"]')?.textContent).toBe('term');
  });

  it('renders the key sentence', () => {
    view({ type: 'key', md: 'This one matters' });
    expect(screen.getByText('This one matters')).toBeTruthy();
  });

  it('compare shows every column title', () => {
    view({
      type: 'compare',
      columns: [
        { title: 'Before', points: ['one'] },
        { title: 'After', tone: 'b', points: ['two'] },
      ],
    });
    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
  });

  it('fdTable flips its live verdict and marks the two rows when an edit breaks the dependency', () => {
    view({
      type: 'fdTable',
      title: 'Does Name decide Weight?',
      columns: ['Name', 'Weight'],
      rows: [['Nidoran', '7.0'], ['Nidoran', '7.0'], ['Pikachu', '6.0']],
      fd: fd('Name', 'Weight'),
      prompt: 'Change a weight.',
    });
    const group = screen.getByRole('group', { name: 'Does Name decide Weight?' });
    expect(within(group).getByText('Holds on these rows')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Row 2, Weight'), { target: { value: '9.0' } });
    expect(within(group).getByText(/Broken by rows 1 and 2/)).toBeTruthy();
    const marked = group.querySelectorAll('tr[data-violates="true"]');
    expect(marked.length).toBe(2);
    const live = group.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toMatch(/Broken/);
    // Only the verdict is live, read whole: not the claim beside it.
    expect(live).toHaveAttribute('aria-atomic', 'true');
    expect(live.textContent).not.toMatch(/Name → Weight/);
  });

  it('closure steps forward to the final set and back again', async () => {
    view({
      type: 'closure',
      title: 'Closure of A',
      attrs: ['A', 'B', 'C'],
      fds: [fd('A', 'B'), fd('B', 'C')],
      start: ['A'],
    });
    const group = screen.getByRole('group', { name: 'Closure of A' });
    expect(within(group).getByText('Step 1 of 3')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Next step' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Next step' }));
    expect(within(group).getByText('Step 3 of 3')).toBeTruthy();
    expect(await within(group).findByText(/Nothing else fires/)).toBeTruthy();
    expect(within(group).getByText(/A is a superkey/)).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Previous step' }));
    expect(within(group).getByText('Step 2 of 3')).toBeTruthy();
  });

  it('bcnf steps through to a done state listing the decomposed relations', async () => {
    view({
      type: 'bcnf',
      title: 'Split MovieStudio',
      relation: { name: 'MovieStudio', attrs: ['title', 'year', 'studioName', 'president', 'presAddr'] },
      fds: [fd('title year', 'studioName'), fd('studioName', 'president'), fd('president', 'presAddr')],
    });
    const group = screen.getByRole('group', { name: 'Split MovieStudio' });
    const next = within(group).getByRole('button', { name: 'Next step' });
    while (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
    expect(await within(group).findByText(/Every relation is in BCNF/)).toBeTruthy();
    expect(within(group).getAllByText('BCNF').length).toBe(3);
    expect(within(group).getByText('presAddr')).toBeTruthy();
  });

  const CHECK: AnswerBlock = {
    type: 'check',
    question: 'Which?',
    options: [
      { text: 'Right one', correct: true, why: 'Because it is right.' },
      { text: 'Wrong one', why: 'Because it is wrong.' },
    ],
  };

  it('check: choosing is not committing — no reason shows until you press Check', () => {
    view(CHECK);
    const group = screen.getByRole('group', { name: 'Which?' });
    const check = within(group).getByRole('button', { name: 'Check' });
    expect(check).toBeDisabled();
    // Arrow keys on native radios fire change: that is choosing, nothing more.
    fireEvent.click(within(group).getByRole('radio', { name: /Right one/ }));
    fireEvent.click(within(group).getByRole('radio', { name: /Wrong one/ }));
    expect(within(group).getByRole('radio', { name: /Wrong one/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /Right one/ })).not.toBeDisabled();
    expect(screen.queryByText('Because it is right.')).toBeNull();
    expect(screen.queryByText('Because it is wrong.')).toBeNull();
    fireEvent.click(check);
    expect(screen.getByText('Because it is wrong.')).toBeTruthy();
    expect(screen.getByText('Because it is right.')).toBeTruthy();
    expect(group.querySelector('[data-correct="true"]')?.textContent).toMatch(/Right one/);
    // Committed: the choice is fixed, and focus lands on what it revealed.
    expect(within(group).getByRole('radio', { name: /Right one/ })).toBeDisabled();
    expect(screen.getByText('Because it is wrong.').closest('[tabindex="-1"]')).toHaveFocus();
  });

  it('check marks the correct option when it is chosen and checked', () => {
    view(CHECK);
    fireEvent.click(screen.getByRole('radio', { name: /Right one/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Because it is right.')).toBeTruthy();
    expect(screen.queryByText('Because it is wrong.')).toBeNull();
    // Try again opens the question again: nothing chosen, nothing marked, focus back on the options.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(document.querySelector('[data-correct]')).toBeNull();
    expect(screen.getByRole('radio', { name: /Right one/ })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /Right one/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Right one/ })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });

  it('steps moves through the labels', () => {
    view({
      type: 'steps',
      title: 'Three steps',
      steps: [
        { label: 'First', body: 'a' },
        { label: 'Second', body: 'b' },
      ],
    });
    const group = screen.getByRole('group', { name: 'Three steps' });
    expect(within(group).getByText('Step 1 of 2')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Next step' }));
    expect(within(group).getByText('Step 2 of 2')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Previous step' }));
    expect(within(group).getByText('Step 1 of 2')).toBeTruthy();
  });
});
