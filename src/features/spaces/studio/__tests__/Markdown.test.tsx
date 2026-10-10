import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '../components/Markdown';

describe('Markdown', () => {
  it('renders headings and lists', () => {
    render(<Markdown>{'### Functional dependencies\n\n- one\n- two'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Functional dependencies' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('does not render raw HTML from Material text', () => {
    const { container } = render(<Markdown>{'<img src=x onerror="alert(1)">hello'}</Markdown>);
    expect(container.querySelector('img[onerror]')).toBeNull();
  });
});
