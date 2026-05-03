import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MindMap, type MindMapState } from '@/components/MindMap';
import type { TreeNode } from '@/types/domain';

function makeLargeTree(): TreeNode {
  const clusters: TreeNode[] = Array.from({ length: 6 }).map((_, ci) => ({
    id: `c-${ci}`,
    label: `Cluster ${ci}`,
    type: 'cluster',
    children: Array.from({ length: 25 }).map((_, si) => ({
      id: `s-${ci}-${si}`,
      label: `Slide ${ci * 25 + si + 1}`,
      type: 'slide',
    })),
  }));
  return {
    id: 'root',
    label: 'Big Lecture',
    type: 'root',
    children: clusters,
  };
}

describe('MindMap states', () => {
  it('renders a spinner in the loading state', () => {
    render(<MindMap state={{ kind: 'loading' }} />);
    expect(screen.getByTestId('mindmap-loading')).toBeInTheDocument();
  });

  it('renders the empty state with a generate CTA when caller can generate', () => {
    const onGenerate = vi.fn();
    render(
      <MindMap
        state={{ kind: 'empty', canGenerate: true, isGenerating: false, onGenerate }}
      />,
    );
    expect(screen.getByTestId('mindmap-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mindmap-generate'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state without a CTA for non-generating viewers', () => {
    render(
      <MindMap state={{ kind: 'empty', canGenerate: false, isGenerating: false }} />,
    );
    expect(screen.getByTestId('mindmap-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('mindmap-generate')).toBeNull();
  });

  it('shows the in-flight message while generating', () => {
    render(
      <MindMap
        state={{ kind: 'empty', canGenerate: true, isGenerating: true, onGenerate: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Generating/i)).toBeInTheDocument();
  });

  it('renders the error state with a retry handler', () => {
    const onRetry = vi.fn();
    render(<MindMap state={{ kind: 'error', message: 'Boom', onRetry }} />);
    expect(screen.getByTestId('mindmap-error-state')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a small ready tree with all expected node types', () => {
    const tree: TreeNode = {
      id: 'root',
      label: 'Lecture',
      type: 'root',
      children: [
        {
          id: 'c-1',
          label: 'Topic',
          type: 'cluster',
          children: [
            { id: 's-1', label: 'Slide A', type: 'slide' },
            { id: 's-2', label: 'Slide B', type: 'slide' },
          ],
        },
      ],
    };
    render(<MindMap state={{ kind: 'ready', tree }} />);
    expect(screen.getByTestId('mindmap-ready')).toBeInTheDocument();
    expect(screen.getAllByTestId('mindmap-node-slide')).toHaveLength(2);
    expect(screen.getByTestId('mindmap-node-cluster')).toBeInTheDocument();
    expect(screen.getByTestId('mindmap-node-root')).toBeInTheDocument();
  });

  it('invokes onSlideClick when a slide-typed node is clicked', () => {
    const onSlideClick = vi.fn();
    const tree: TreeNode = {
      id: 'root',
      label: 'L',
      type: 'root',
      children: [{ id: 's-1', label: 'Slide A', type: 'slide' }],
    };
    render(
      <MindMap state={{ kind: 'ready', tree }} onSlideClick={onSlideClick} />,
    );
    fireEvent.click(screen.getByTestId('mindmap-node-slide'));
    expect(onSlideClick).toHaveBeenCalledWith('s-1');
  });

  it('does not invoke onSlideClick for non-slide nodes', () => {
    const onSlideClick = vi.fn();
    const tree: TreeNode = {
      id: 'root',
      label: 'L',
      type: 'root',
      children: [{ id: 'c-1', label: 'Cluster', type: 'cluster' }],
    };
    render(
      <MindMap state={{ kind: 'ready', tree }} onSlideClick={onSlideClick} />,
    );
    fireEvent.click(screen.getByTestId('mindmap-node-cluster'));
    expect(onSlideClick).not.toHaveBeenCalled();
  });

  it('renders large lectures (150 slides) without throwing', () => {
    const tree = makeLargeTree();
    const state: MindMapState = { kind: 'ready', tree };
    render(<MindMap state={state} />);
    expect(screen.getByTestId('mindmap-ready')).toBeInTheDocument();
    expect(screen.getAllByTestId('mindmap-node-slide')).toHaveLength(150);
  });
});
