/**
 * Immersive full-bleed "Mindmap" view for Learning Insights.
 *
 * The 3D knowledge map fills the whole content area (rendered transparent so it
 * blends into the page) over an anime.js-driven ambient background: a few large
 * blurred colour blobs that slowly drift and breathe, tying the floating graph
 * into the surrounding surface. A floating glass header overlays the scene with
 * the view tabs, a back button and the legend.
 *
 * anime.js is scoped via `createScope({ root })` and torn down with
 * `scope.revert()` on unmount. All motion is gated on `prefers-reduced-motion`.
 */
import { useEffect, useRef } from 'react';
import { animate, createScope, stagger, type Scope } from 'animejs';
import { ChevronLeft, Sparkles } from 'lucide-react';
import type { TreeNode } from '@/types/domain';
import { MindMapGraph3D } from '@/components/MindMapGraph3D';
import { InsightsViewTabs, type InsightsView } from '@/components/InsightsViewTabs';

interface Props {
  tree: TreeNode;
  hasContent: boolean;
  view: InsightsView;
  onViewChange: (v: InsightsView) => void;
  onOpenLecture: (lectureId: string) => void;
  onBack: () => void;
}

const LEGEND = [
  { label: 'Course', className: 'bg-secondary' },
  { label: 'Lecture', className: 'bg-foreground' },
  { label: 'Focus', className: 'bg-primary' },
];

export function InsightsMindmapView({
  tree,
  hasContent,
  view,
  onViewChange,
  onOpenLecture,
  onBack,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<Scope | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    scopeRef.current = createScope({ root: rootRef }).add(() => {
      // Entrance: float the overlay chrome up and in.
      animate('[data-anim="overlay"]', {
        opacity: [0, 1],
        translateY: [18, 0],
        duration: 600,
        delay: stagger(90),
        ease: 'outExpo',
      });

      if (reduced) return;

      // Ambient background: each blob drifts + breathes on its own loop.
      animate('[data-anim="blob"]', {
        translateX: () => [0, 40 - Math.random() * 80],
        translateY: () => [0, 40 - Math.random() * 80],
        scale: [1, 1.25],
        opacity: [0.35, 0.6],
        duration: () => 9000 + Math.random() * 6000,
        delay: stagger(800),
        loop: true,
        alternate: true,
        ease: 'inOutSine',
      });
    });

    return () => scopeRef.current?.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden bg-background"
      data-testid="insights-mindmap-view"
    >
      {/* anime.js ambient background — blurred colour fields behind the map */}
      <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
        <div
          data-anim="blob"
          className="absolute top-[12%] left-[18%] w-[42vw] h-[42vw] max-w-[640px] max-h-[640px] rounded-full bg-primary/25 blur-[120px]"
        />
        <div
          data-anim="blob"
          className="absolute bottom-[8%] right-[14%] w-[38vw] h-[38vw] max-w-[560px] max-h-[560px] rounded-full bg-secondary/25 blur-[120px]"
        />
        <div
          data-anim="blob"
          className="absolute top-[40%] right-[34%] w-[28vw] h-[28vw] max-w-[420px] max-h-[420px] rounded-full bg-xp/15 blur-[100px]"
        />
      </div>

      {/* The 3D knowledge map, transparent so the ambient layer shows through */}
      <div className="absolute inset-0">
        {hasContent ? (
          <MindMapGraph3D
            tree={tree}
            onSlideClick={onOpenLecture}
            height="100%"
            transparent
            hideHint
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
            <Sparkles className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-bold text-foreground">No courses to map yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Open a lecture in any course to see your knowledge connect in space.
            </p>
          </div>
        )}
      </div>

      {/* Floating glass header overlay */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4 md:p-6">
        <div data-anim="overlay" className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to dashboard"
            className="flex h-10 w-10 items-center justify-center rounded-xl glass-card border-white/10 text-muted-foreground hover:text-foreground cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="hidden sm:block glass-card border-white/10 rounded-xl px-4 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
              Knowledge Map
            </p>
            <p className="text-sm font-bold text-foreground tracking-tight">Topics in space</p>
          </div>
        </div>

        <div data-anim="overlay">
          <InsightsViewTabs view={view} onChange={onViewChange} />
        </div>
      </div>

      {/* Legend */}
      <div
        data-anim="overlay"
        className="absolute bottom-4 right-4 z-10 flex items-center gap-4 glass-card border-white/10 rounded-xl px-4 py-2.5"
      >
        {LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${item.className}`} aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
