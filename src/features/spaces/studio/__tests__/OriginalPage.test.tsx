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
    fireEvent.click(screen.getByRole('button', { name: 'Back to (edited): Functional dependencies' }));
    expect(onRegion).toHaveBeenCalledWith('c-a');
    expect(screen.getByText('Edited by you')).toBeInTheDocument();
  });

  it('reveals what is not in your version and offers to add it', () => {
    const onInclude = vi.fn();
    render(<OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={onInclude} />);
    fireEvent.click(screen.getByRole('button', { name: /^Not in your version: / }));
    expect(onInclude).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Add to your version: / }));
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

  it('summarises missing figures once instead of labelling each', () => {
    const withFigure: SourcePage = {
      ...page,
      blocks: [...page.blocks, { id: 'g', page: 4, bbox: [0.5, 0.3, 0.9, 0.8], kind: 'figure', text: '', readingOrder: 2 }],
    };
    render(<OriginalPage page={withFigure} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={vi.fn()} />);
    expect(screen.getByText('1 figure not in your version').tagName).not.toBe('BUTTON');
    expect(screen.queryByText('Figure not in your version')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Not in your version: / })).toHaveLength(1);
  });

  it('marks the overlays that fly only on the anchor page', () => {
    const { container, rerender } = render(
      <OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={vi.fn()} />,
    );
    expect(container.querySelector('[data-morph]')).toBeNull();
    rerender(<OriginalPage page={page} blocks={blocks} morph materialName="N.pdf" onRegion={vi.fn()} onInclude={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Back to (edited): Functional dependencies' })).toHaveAttribute('data-morph', 'true');
  });

  it('pluralises the figure summary and omits it when none are missing', () => {
    const fig = (id: string, y: number) => ({ id, page: 4, bbox: [0.5, y, 0.9, y + 0.1] as [number, number, number, number], kind: 'figure' as const, text: '', readingOrder: 2 });
    const two: SourcePage = { ...page, blocks: [...page.blocks, fig('g1', 0.3), fig('g2', 0.5)] };
    const { unmount } = render(<OriginalPage page={two} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={vi.fn()} />);
    expect(screen.getByText('2 figures not in your version')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Not in your version: / })).toHaveLength(1);
    unmount();
    render(<OriginalPage page={page} blocks={blocks} morph={false} materialName="N.pdf" onRegion={vi.fn()} onInclude={vi.fn()} />);
    expect(screen.queryByText(/not in your version$/)).toBeNull();
  });
});
