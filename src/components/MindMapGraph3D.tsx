/**
 * Spatial mind-map wrapper.
 *
 * Owns the concerns that must live outside the WebGL bundle: feature-detecting
 * WebGL, honouring `prefers-reduced-motion`, flattening the lecture tree into a
 * graph, and lazy-loading the heavy three.js canvas only once. Mirrors the
 * defensive pattern in `ThreeDScatterPlot` (skeleton → fallback → lazy canvas).
 *
 * If WebGL is unavailable it renders an inline notice. When the caller wires
 * up `onSwitchTo2D`, the notice also gets a working button that flips the
 * parent view straight to its 2D equivalent instead of just describing one in
 * prose (M47) — otherwise it falls back to the generic copy and the caller is
 * expected to keep its own 2D toggle reachable (e.g. `MindMap`'s 2D/3D switch).
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Orbit } from 'lucide-react';
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
  /**
   * Called when the user clicks the WebGL-unavailable fallback's action
   * button. Pass this to switch the parent view to its 2D equivalent (e.g.
   * the Skill Tree). When omitted, the fallback shows generic prose instead
   * of a button — use this only when the caller doesn't already surface an
   * in-pane 2D toggle of its own.
   */
  onSwitchTo2D?: () => void;
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
  onSwitchTo2D,
}: Props) {
  const { t } = useTranslation('gamification');
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
        <p className="text-sm font-bold text-foreground">{t('ascent.mindMap3d.unavailableTitle')}</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {onSwitchTo2D
            ? t('ascent.mindMap3d.unavailableBodyWithAction')
            : t('ascent.mindMap3d.unavailableBodyGeneric')}
        </p>
        {onSwitchTo2D && (
          <button
            type="button"
            onClick={onSwitchTo2D}
            data-testid="mindmap-3d-switch-to-skills"
            className="mt-1 inline-flex items-center gap-2 px-4 h-9 rounded-xl glass-card border-white/10 text-xs font-bold uppercase tracking-widest text-foreground hover:text-primary cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <GitBranch className="w-4 h-4" aria-hidden="true" />
            {t('ascent.mindMap3d.switchToSkills')}
          </button>
        )}
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
