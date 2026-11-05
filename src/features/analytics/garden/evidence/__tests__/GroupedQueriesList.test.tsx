import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroupedQueriesList } from '../GroupedQueriesList';

describe('GroupedQueriesList', () => {
  it('says it waits for five askers when withheld, and never prints (0)', () => {
    const { container } = render(
      <GroupedQueriesList evidence={{ kind: 'ai_queries', queries: [], totalCount: null }} />,
    );
    expect(screen.getByText(/shows once five students have asked the ai tutor about this slide/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\(0\)|were asked/);
  });

  it('still says none were asked on this slide when five asked elsewhere in the lecture', () => {
    render(<GroupedQueriesList evidence={{ kind: 'ai_queries', queries: [], totalCount: 0 }} />);
    expect(screen.getByText(/no ai-tutor questions were asked on this slide/i)).toBeInTheDocument();
  });

  it('lists the questions with their count when shown', () => {
    render(
      <GroupedQueriesList
        evidence={{ kind: 'ai_queries', queries: [{ query: 'why?', response: null, createdAt: '2026-11-03' }], totalCount: 1 }}
      />,
    );
    expect(screen.getByText('why?')).toBeInTheDocument();
    expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
  });
});
