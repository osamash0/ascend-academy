import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CheckpointCard } from '../reader/CheckpointCard';
import type { Checkpoint } from '../../data/liveRepository';

const LEC = 'l';
const CP: Checkpoint = {
  idea: 'Closure',
  first: 32,
  last: 40,
  cached: true,
  questions: [
    {
      id: 1,
      kind: 'choice',
      lecture_id: LEC,
      page: 37,
      idea: 'Membership',
      prompt: 'Can D → A be derived?',
      why: 'D⁺ = {D, E}.',
      options: [{ text: 'Yes' }, { text: 'No', correct: true }],
    },
  ],
} as Checkpoint;

describe('a checkpoint at the end of an idea', () => {
  it('offers, asks, grades, and reports what to light', async () => {
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <CheckpointCard
          idea={{ name: 'Closure', first: 32, last: 40 }}
          lectureTitle="Normalization"
          load={() => Promise.resolve(CP)}
          pageHref={(p) => `/read?page=${p}`}
          onDone={onDone}
          onDismiss={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Check it while it is fresh.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /One question/ }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Checkpoint: Closure' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^B\s*No$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    expect(screen.getByText('Closure is lit.')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith({
      correct: 1,
      total: 1,
      results: [{ page: 37, idea: 'Closure', kind: 'choice', correct: true }],
    });
  });

  it('is gone with “Not now”', () => {
    const onDismiss = vi.fn();
    render(
      <MemoryRouter>
        <CheckpointCard
          idea={{ name: 'Closure', first: 32, last: 40 }}
          lectureTitle="Normalization"
          load={() => Promise.resolve(CP)}
          pageHref={() => '/'}
          onDone={() => {}}
          onDismiss={onDismiss}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
