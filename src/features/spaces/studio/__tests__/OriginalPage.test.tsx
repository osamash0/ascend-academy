import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OriginalPage } from '../components/OriginalPage';
import type { CanvasBlock, SourcePage } from '../types';

const page: SourcePage = {
  materialId: 'm', page: 4, width: 720, height: 405, imageUrl: '/p4.webp', geometry: 'block',
  blocks: [
    { id: 'a', page: 4, bbox: [0.1, 0.1, 0.6, 0.2], kind: 'heading', text: 'Functional dependencies', readingOrder: 0 },
    { id: 'f', page: 4, bbox: [0.1, 0.93, 0.4, 0.97], kind: 'paragraph', text: 'footer', readingOrder: 1 },
  ],
};
const blocks: CanvasBlock[] = [
  { id: 'c-a', origin: 'extracted', markdown: '### Functional dependencies', source: { materialId: 'm', page: 4, blockIds: ['a'] }, edited: true },
];

describe('OriginalPage', () => {
  it('shows the real page, a way back per paragraph, and what was edited', () => {
    const onRegion = vi.fn();
    render(<OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={onRegion} onInclude={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Page 4 of N.pdf' })).toHaveAttribute('src', '/p4.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Back to: Functional dependencies' }));
    expect(onRegion).toHaveBeenCalledWith('c-a');
    expect(screen.getByText('Edited by you')).toBeInTheDocument();
  });

  it('reveals what is not in your version and offers to add it', () => {
    const onInclude = vi.fn();
    render(<OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={onInclude} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not in your version' }));
    expect(onInclude).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add to your version' }));
    expect(onInclude).toHaveBeenCalledWith('f');
  });

  it('offers a single way back on a page without coordinates', () => {
    const onRegion = vi.fn();
    const flat = { ...page, geometry: 'page' as const, blocks: [] };
    const refs: CanvasBlock[] = [{ ...blocks[0], source: { materialId: 'm', page: 4, blockIds: [] } } as CanvasBlock];
    render(<OriginalPage page={flat} blocks={refs} morph={false} materialName="N.pdf" onRegion={onRegion} onInclude={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the clean version' }));
    expect(onRegion).toHaveBeenCalledWith('c-a');
  });
});
