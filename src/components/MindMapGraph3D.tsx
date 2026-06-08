/**
 * Spatial mind-map wrapper.
 *
 * Owns the concerns that must live outside the WebGL bundle: feature-detecting
 * WebGL, honouring `prefers-reduced-motion`, flattening the lecture tree into a
 * graph, and lazy-loading the heavy three.js canvas only once. Mirrors the
 * defensive pattern in `ThreeDScatterPlot` (skeleton → fallback → lazy canvas).
 *
 * If WebGL is unavailable it renders an inline notice; the caller keeps the 2D
 * `MindMap` tree available via the view toggle, so this never leaves a dead panel.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Orbit } from 'lucide-react';
import type { TreeNode } from '@/types/domain';
import { flattenTree } from '@/features/mindmap/graph3d';

const MindMapGraph3DCanvas = lazy(() => import('./MindMapGraph3DCanvas'));

interface Props {
  tree: TreeNode;
  currentSlideId?: string;
  onSlideClick?: (slideId: string) => void;
  height?: number | string;
  /** Clear the canvas to transparent so a page background shows through. */
  transparent?: boolean;
  /** Hide the built-in orbit/zoom hint (immersive views supply their own). */
  hideHint?: boolean;
}

function Skeleton({ height }: { height: number | string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3"
      style={{ height }}
      data-testid="mindmap-3d-skeleton"
    >
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-muted-foreground">Building spatial map…</p>
    </div>
  );
}

export function MindMapGraph3D({
  tree,
  currentSlideId,
  onSlideClick,
  height = 480,
  transparent,
  hideHint,
}: Props) {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setWebglSupported(!!gl);
    } catch {
      setWebglSupported(false);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const data = useMemo(() => flattenTree(tree), [tree]);

  if (webglSupported === null) return <Skeleton height={height} />;

  if (!webglSupported) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-center px-6"
        style={{ height }}
        data-testid="mindmap-3d-unsupported"
      >
        <Orbit className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-bold text-foreground">3D view unavailable</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Your browser or device doesn’t support WebGL. Switch back to the 2D tree to explore the map.
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<Skeleton height={height} />}>
      <MindMapGraph3DCanvas
        data={data}
        currentSlideId={currentSlideId}
        onSlideClick={onSlideClick}
        height={height}
        prefersReducedMotion={reducedMotion}
        transparent={transparent}
        hideHint={hideHint}
      />
    </Suspense>
  );
}
