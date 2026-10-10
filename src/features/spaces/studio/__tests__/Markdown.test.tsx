import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '../components/Markdown';

describe('Markdown', () => {
  it('renders headings and lists', () => {
    render(<Markdown>{'### Functional dependencies\n\n- one\n- two'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Functional dependencies' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('does not parse raw HTML images from Material text', () => {
    const { container } = render(<Markdown>{'<img src="https://evil.example/x.png" onerror="alert(1)">hello'}</Markdown>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('hello');
  });

  it('does not parse other raw HTML', () => {
    const { container } = render(<Markdown>{'<details><summary>s</summary>secret</details>\n\n<b>bold</b>'}</Markdown>);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('renders no markdown images: remote ones would be a fetch to a third party', () => {
    const { container } = render(
      <Markdown>{'![a](https://evil.example/y.png)\n\n![b](/v4-mock/studio/normalization-p1.webp)'}</Markdown>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('produces no DOM nesting warnings', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Markdown>{'Some *text*\n\n- a\n- b\n\n<details>x</details>'}</Markdown>);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
