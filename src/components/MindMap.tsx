/**
 * Lecture mind map — d3-hierarchy tidy-tree layout.
 *
 * This component is intentionally state-aware: callers pass a discriminated
 * `state` (loading | empty | error | ready) so the renderer always shows the
 * correct UX for the four lifecycle stages, never a blank panel.
 */
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { hierarchy, tree as d3tree, type HierarchyPointNode } from 'd3-hierarchy';
import type { TreeNode } from '@/types/domain';
import { MindMapErrorBoundary } from '@/features/mindmap/MindMapErrorBoundary';

// ─── State contract ────────────────────────────────────────────────────────

export type MindMapState =
  | { kind: 'loading' }
  | { kind: 'empty'; canGenerate: boolean; isGenerating: boolean; onGenerate?: () => void }
  | { kind: 'error'; message: string; onRetry?: () => void }
  | { kind: 'ready'; tree: TreeNode };

interface MindMapProps {
  state: MindMapState;
  currentSlideId?: string;
  onSlideClick?: (slideId: string) => void;
  /** Called when the user clicks "Retry" inside the render-crash error boundary. */
  onErrorBoundaryRetry?: () => void;
  height?: number;
}

// ─── Style per node type ───────────────────────────────────────────────────

const NODE_W: Record<TreeNode['type'], number> = {
  root: 180,
  cluster: 160,
  slide: 150,
  concept: 130,
};
const NODE_H: Record<TreeNode['type'], number> = {
  root: 56,
  cluster: 44,
  slide: 40,
  concept: 36,
};
const ROW_GAP = 28;
const COL_GAP = 60;

function nodeClass(type: TreeNode['type'], active: boolean, clickable: boolean) {
  const base = 'flex items-center justify-center rounded-2xl border w-full h-full px-3 text-center transition';
  const cursor = clickable ? 'cursor-pointer hover:brightness-110' : 'cursor-default';
  const ring = active ? 'ring-2 ring-primary shadow-glow-primary' : '';
  switch (type) {
    case 'root':
      return `${base} ${cursor} ${ring} bg-gradient-to-r from-primary to-secondary text-white border-primary/40 font-bold`;
    case 'cluster':
      return `${base} ${cursor} ${ring} bg-secondary/20 text-foreground border-secondary/40 font-semibold`;
    case 'slide':
      return `${base} ${cursor} ${ring} bg-surface-2 text-foreground border-border`;
    case 'concept':
    default:
      return `${base} ${cursor} ${ring} bg-xp/10 text-muted-foreground border-xp/30 italic`;
  }
}

// ─── Inner renderer (only invoked in 'ready' state) ────────────────────────

function MindMapTree({
  tree,
  currentSlideId,
  onSlideClick,
  height,
}: {
  tree: TreeNode;
  currentSlideId?: string;
  onSlideClick?: (slideId: string) => void;
  height: number;
}) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const layout = useMemo(() => {
    const root = hierarchy<TreeNode>(tree, (d) => d.children ?? []);
    // Tidy tree, vertical (root at top). nodeSize gives us a per-node tile so
    // siblings never overlap regardless of depth or label length.
    const layoutFn = d3tree<TreeNode>().nodeSize([
      NODE_W.cluster + COL_GAP,
      NODE_H.cluster + ROW_GAP * 4,
    ]);
    const positioned = layoutFn(root);
    const nodes = positioned.descendants();
    const links = positioned.links();
    if (nodes.length === 0) {
      return { nodes, links, minX: 0, maxX: 0, maxY: 0 };
    }
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    return {
      nodes,
      links,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }, [tree]);

  const padX = NODE_W.root;
  const width = Math.max(400, layout.maxX - layout.minX + padX * 2);
  const svgHeight = Math.max(height, layout.maxY + NODE_H.root + 32);
  const offsetX = -layout.minX + padX;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isPanning.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }, []);
  const onMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setTransform((t) => ({
      ...t,
      scale: Math.min(2, Math.max(0.3, t.scale + delta)),
    }));
  }, []);
  const reset = useCallback(() => setTransform({ x: 0, y: 0, scale: 1 }), []);

  const linkPath = (l: { source: HierarchyPointNode<TreeNode>; target: HierarchyPointNode<TreeNode> }) => {
    const sx = l.source.x + offsetX;
    const sy = l.source.y + NODE_H[l.source.data.type] / 2;
    const tx = l.target.x + offsetX;
    const ty = l.target.y - NODE_H[l.target.data.type] / 2;
    const my = (sy + ty) / 2;
    return `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`;
  };

  return (
    <div
      className="relative select-none"
      style={{ height }}
      data-testid="mindmap-ready"
    >
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <button
          onClick={() => setTransform((t) => ({ ...t, scale: Math.min(2, t.scale + 0.15) }))}
          className="w-8 h-8 glass-card border-white/10 rounded-lg text-muted-foreground hover:text-foreground text-sm font-bold flex items-center justify-center"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale - 0.15) }))}
          className="w-8 h-8 glass-card border-white/10 rounded-lg text-muted-foreground hover:text-foreground text-sm font-bold flex items-center justify-center"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={reset}
          className="px-3 h-8 glass-card border-white/10 rounded-lg text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase tracking-widest"
        >
          Reset
        </button>
      </div>

      <div
        className="absolute inset-0 overflow-hidden"
        style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <svg
          width={width}
          height={svgHeight}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <g>
            {layout.links.map((l, i) => (
              <path
                key={`edge-${i}`}
                d={linkPath(l)}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={1.5}
              />
            ))}
            {layout.nodes.map((n) => {
              const w = NODE_W[n.data.type];
              const h = NODE_H[n.data.type];
              const x = n.x + offsetX - w / 2;
              const y = n.y - h / 2;
              const isSlide = n.data.type === 'slide';
              const active = !!currentSlideId && n.data.id === currentSlideId;
              const clickable = isSlide && !!onSlideClick;
              const handleClick = () => {
                if (clickable) onSlideClick?.(n.data.id);
              };
              return (
                <foreignObject key={n.data.id} x={x} y={y} width={w} height={h}>
                  <div
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : -1}
                    title={n.data.summary || n.data.label}
                    data-testid={`mindmap-node-${n.data.type}`}
                    data-node-id={n.data.id}
                    onClick={handleClick}
                    onKeyDown={(e) => {
                      if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        handleClick();
                      }
                    }}
                    className={nodeClass(n.data.type, active, clickable)}
                  >
                    <span className="text-[11px] truncate w-full leading-tight">
                      {n.data.label}
                    </span>
                  </div>
                </foreignObject>
              );
            })}
          </g>
        </svg>
      </div>

      <p className="absolute bottom-2 left-3 z-10 text-[9px] text-muted-foreground/40 uppercase tracking-widest pointer-events-none">
        Drag to pan · Scroll to zoom · Click a slide to open it
      </p>
    </div>
  );
}

// ─── State router ──────────────────────────────────────────────────────────

export function MindMap({
  state,
  currentSlideId,
  onSlideClick,
  onErrorBoundaryRetry,
  height = 480,
}: MindMapProps) {
  if (state.kind === 'loading') {
    return (
      <div
        data-testid="mindmap-loading"
        className="flex flex-col items-center justify-center py-16 gap-4"
        style={{ minHeight: height }}
      >
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-muted-foreground">Loading mind map…</p>
      </div>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div
        data-testid="mindmap-empty"
        className="flex flex-col items-center justify-center py-16 gap-5"
        style={{ minHeight: height }}
      >
        <div className="text-4xl">🧠</div>
        <div className="text-center">
          <p className="text-sm font-bold text-foreground mb-1">No mind map yet</p>
          <p className="text-xs text-muted-foreground">
            {state.canGenerate
              ? 'Generate a visual knowledge tree from all lecture slides'
              : 'Your professor has not generated a mind map for this lecture yet.'}
          </p>
        </div>
        {state.canGenerate && state.onGenerate && (
          <button
            onClick={state.onGenerate}
            disabled={state.isGenerating}
            data-testid="mindmap-generate"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-bold disabled:opacity-50"
          >
            {state.isGenerating ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating… this can take 20–40 seconds
              </>
            ) : (
              <>✨ Generate Mind Map</>
            )}
          </button>
        )}
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        data-testid="mindmap-error-state"
        className="flex flex-col items-center justify-center py-16 gap-4 text-center"
        style={{ minHeight: height }}
      >
        <div className="text-3xl">⚠️</div>
        <div>
          <p className="text-sm font-bold text-foreground mb-1">
            We couldn’t load the mind map
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">{state.message}</p>
        </div>
        {state.onRetry && (
          <button
            onClick={state.onRetry}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:opacity-90"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <MindMapErrorBoundary onRetry={onErrorBoundaryRetry}>
      <MindMapTree
        tree={state.tree}
        currentSlideId={currentSlideId}
        onSlideClick={onSlideClick}
        height={height}
      />
    </MindMapErrorBoundary>
  );
}
