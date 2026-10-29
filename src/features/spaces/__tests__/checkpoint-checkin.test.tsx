import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { CheckpointCard } from '../components/reader/CheckpointCard';
import type { Checkpoint } from '../data/liveRepository';

const CP: Checkpoint = {
  idea: 'Joins',
  first: 4,
  last: 9,
  cached: true,
  questions: [
    {
      id: 1, lecture_id: 'l1', page: 9, idea: 'Joins', prompt: 'Which join keeps every left row?', why: '',
      kind: 'choice', options: [{ text: 'Inner' }, { text: 'Left', correct: true }],
    } as Checkpoint['questions'][number],
  ],
};

const card = (extra: Partial<Parameters<typeof CheckpointCard>[0]> = {}) =>
  render(
    <MemoryRouter>
      <CheckpointCard
        idea={{ name: 'Joins', first: 4, last: 9 }}
        lectureTitle="Relational Algebra"
        load={() => Promise.resolve(CP)}
        pageHref={(p) => `/p/${p}`}
        onDone={vi.fn()}
        onDismiss={vi.fn()}
        {...extra}
      />
    </MemoryRouter>,
  );

describe('the checkpoint', () => {
  it('offers a quiet check-in that never stands in the way of the question', () => {
    const onCheckIn = vi.fn();
    card({ onCheckIn });
    const foggy = screen.getByRole('button', { name: 'Still foggy' });
    expect(foggy).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(foggy);
    expect(onCheckIn).toHaveBeenCalledWith('confused');
    expect(foggy).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clicked' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /One question/ })).toBeEnabled();
    /* A repeat tap on the one already chosen says nothing new; switching does. */
    fireEvent.click(foggy);
    expect(onCheckIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clicked' }));
    expect(onCheckIn).toHaveBeenCalledTimes(2);
    expect(onCheckIn).toHaveBeenLastCalledWith('got_it');
  });

  it('hands every answer on, with the span the checkpoint was served for', async () => {
    const onAnswer = vi.fn();
    card({ onAnswer });
    fireEvent.click(screen.getByRole('button', { name: /One question/ }));
    await waitFor(() => screen.getByText('Which join keeps every left row?'));
    fireEvent.click(screen.getByRole('button', { name: /^B\s*Left$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onAnswer).toHaveBeenCalledWith(1, { kind: 'choice', index: 1 }, { first: 4, last: 9 });
  });

  it('offers no check-in once the question could not be written', async () => {
    card({ onCheckIn: vi.fn(), load: () => Promise.reject(new Error('down')) });
    expect(screen.getByRole('group', { name: 'How did it land?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /One question/ }));
    await waitFor(() => screen.getByText("Couldn't write a question just now."));
    expect(screen.queryByRole('group', { name: 'How did it land?' })).not.toBeInTheDocument();
  });
});
