import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CleanBlock } from '../components/CleanBlock';
import type { SummaryBlock } from '../types';

const block = (gist: boolean): SummaryBlock => ({
  id: 's', origin: 'summary', markdown: 'A **functional dependency** holds.', gist, edited: false,
  source: { materialId: 'm', page: 6, blockIds: ['b'] },
});
const props = {
  page: 6, index: 0, count: 1, morph: false, flying: false, lowConfidence: false, active: false, flash: false,
  markerDisabled: false, glow: false,
  onPointerEnter: vi.fn(), onPointerLeave: vi.fn(), onOpenPeek: vi.fn(), onClosePeek: vi.fn(),
};

describe('a summary paragraph', () => {
  it('has a page marker and counts as sourced', () => {
    const { container, getByRole } = render(<CleanBlock {...props} block={block(false)} />);
    expect(getByRole('button', { name: 'Show the source, page 6' })).toBeInTheDocument();
    expect(container.querySelector('[data-extracted="true"]')).not.toBeNull();
  });
  it('marks the gist and renders key terms as strong', () => {
    const { container } = render(<CleanBlock {...props} block={block(true)} />);
    expect(container.querySelector('[data-gist="true"].studio-gist')).not.toBeNull();
    expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('functional dependency');
  });
  it('does not mark a non-gist paragraph', () => {
    const { container } = render(<CleanBlock {...props} block={block(false)} />);
    expect(container.querySelector('[data-gist]')).toBeNull();
  });
});
