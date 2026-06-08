/**
 * Immersive "Skills" view for Learning Insights.
 *
 * Layout = lanes: each course is a horizontal row, and its lectures form a
 * left→right chain (course → l1 → l2 → …) so the sequential locks read as a
 * path you progress along. A central "Your Skills" hub links to every course.
 * Lecture concepts (when available) sprout below their lecture and can be
 * expanded. This is deliberately simpler than a sprawling tidy-tree so it's easy
 * to track. Clicking any node opens a short info panel.
 *
 * anime.js drives the dynamic feel — connector draw-in, entrance stagger,
 * owned-node glow pulse, and the mastered counter — all scoped/reverted and
 * gated on prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, createScope, stagger, svg, utils, type Scope } from 'animejs';
import { ChevronLeft, Sparkles, GitBranch, X, ArrowRight, Lock } from 'lucide-react';
import { InsightsViewTabs, type InsightsView } from '@/components/InsightsViewTabs';
import { SkillNode, BOX_W, BOX_H } from '@/components/SkillNode';
import type { SkillNode as SkillNodeData } from '@/features/skilltree/skillTree';

interface Props {
  tree: SkillNodeData;
  counts: { owned: number; total: number };
  conceptsAvailable: boolean;
  hasContent: boolean;
  view: InsightsView;
  onViewChange: (v: InsightsView) => void;
  onOpenLecture: (lectureId: string) => void;
  onBack: () => void;
}

const ROOT_X = 0;
const COURSE_X = 220;
const COL_W = 156; // step between sequential lectures
const LANE_BASE = 150; // base vertical room per course lane
const CONCEPT_GAP = 70; // spacing of concept offshoots

const STATE_LABEL: Record<SkillNodeData['state'], string> = {
  locked: 'Locked',
  available: 'Available',
  in_progress: 'In progress',
  owned: 'Owned',
};
const STATE_DOT: Record<SkillNodeData['state'], string> = {
  locked: 'bg-surface-3 text-muted-foreground',
  available: 'bg-primary/20 text-primary',
  in_progress: 'bg-secondary/20 text-secondary',
  owned: 'bg-success/20 text-success',
};

const LEGEND = [
  { label: 'Owned', className: 'bg-success' },
  { label: 'In progress', className: 'bg-secondary' },
  { label: 'Locked', className: 'bg-surface-3' },
];

interface Placed {
  node: SkillNodeData;
  x: number;
  y: number;
}
interface Edge {
  id: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  state: SkillNodeData['state'];
}

/**
 * Start fully collapsed to a single "My Skills" circle: the root and every
 * concept-bearing lecture begin collapsed. Expanding the root reveals the
 * course lanes; expanding a lecture reveals its concepts.
 */
function defaultCollapsed(root: SkillNodeData): Set<string> {
  const set = new Set<string>([root.id]);
  root.children?.forEach((course) =>
    course.children?.forEach((n) => {
      if (n.kind === 'lecture' && n.children?.length) set.add(n.id);
    }),
  );
  return set;
}

function layoutLanes(tree: SkillNodeData, collapsed: Set<string>) {
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  // Root collapsed → show only the single "My Skills" circle.
  const courses = collapsed.has(tree.id) ? [] : tree.children ?? [];
  const courseYs: number[] = [];
  let laneTop = 0;

  for (const course of courses) {
    const lectures = collapsed.has(course.id)
      ? []
      : (course.children ?? []).filter((n) => n.kind === 'lecture');
    const maxConcepts = Math.max(
      0,
      ...lectures.map((l) => (collapsed.has(l.id) ? 0 : l.children?.length ?? 0)),
    );
    const laneHeight = LANE_BASE + (maxConcepts > 0 ? maxConcepts * CONCEPT_GAP + 24 : 0);
    const y = laneTop + LANE_BASE / 2;
    courseYs.push(y);

    placed.push({ node: course, x: COURSE_X, y });
    let prevX = COURSE_X;
    lectures.forEach((lec, i) => {
      const x = COURSE_X + COL_W * (i + 1);
      placed.push({ node: lec, x, y });
      edges.push({ id: `e-${lec.id}`, sx: prevX, sy: y, tx: x, ty: y, state: lec.state });
      prevX = x;
      if (!collapsed.has(lec.id)) {
        (lec.children ?? []).forEach((c, ki) => {
          const cy = y + LANE_BASE / 2 + 8 + ki * CONCEPT_GAP;
          placed.push({ node: c, x, y: cy });
          edges.push({ id: `e-${c.id}`, sx: x, sy: y, tx: x, ty: cy, state: c.state });
        });
      }
    });
    laneTop += laneHeight;
  }

  const rootY = courseYs.length ? (courseYs[0] + courseYs[courseYs.length - 1]) / 2 : 0;
  placed.unshift({ node: tree, x: ROOT_X, y: rootY });
  courses.forEach((course, ci) =>
    edges.push({ id: `er-${course.id}`, sx: ROOT_X, sy: rootY, tx: COURSE_X, ty: courseYs[ci], state: course.state }),
  );

  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  return {
    placed,
    edges,
    minX: Math.min(...xs, 0),
    maxX: Math.max(...xs, 0),
    minY: Math.min(...ys, 0),
    maxY: Math.max(...ys, 0),
  };
}

function edgePath(sx: number, sy: number, tx: number, ty: number) {
  const mx = (sx + tx) / 2;
  return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
}

const edgeColor = (s: SkillNodeData['state']) =>
  s === 'owned'
    ? 'hsl(var(--success))'
    : s === 'in_progress'
      ? 'hsl(var(--secondary))'
      : s === 'available'
        ? 'hsl(var(--primary))'
        : 'hsl(var(--border))';

export function SkillTreeView({
  tree,
  counts,
  conceptsAvailable,
  hasContent,
  view,
  onViewChange,
  onOpenLecture,
  onBack,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<Scope | null>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const interactedRef = useRef(false);
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed(tree));
  const [transform, setTransform] = useState({ x: 80, y: 0, scale: 0.9 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const layout = useMemo(() => layoutLanes(tree, collapsed), [tree, collapsed]);

  const offX = -layout.minX + BOX_W;
  const offY = -layout.minY + BOX_H;
  const width = layout.maxX - layout.minX + BOX_W * 2;
  const height = layout.maxY - layout.minY + BOX_H * 2;

  const selected = useMemo(
    () => layout.placed.find((p) => p.node.id === selectedId)?.node ?? null,
    [layout.placed, selectedId],
  );

  // Fit the whole tree to the container (re-fit as it settles / on resize, until
  // the user pans or zooms).
  useEffect(() => {
    if (!hasContent) return;
    const fit = () => {
      if (interactedRef.current) return;
      const el = rootRef.current;
      if (!el || !el.clientWidth || !el.clientHeight) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      // Keep nodes legible (min 0.5). When the tree is wider/taller than the
      // viewport at that scale, anchor to the top-left so the user pans along
      // each course chain rather than squinting at a shrunk-to-fit whole.
      const scale = Math.max(0.5, Math.min(1.1, Math.min(cw / width, ch / height) * 0.92));
      const x = width * scale <= cw ? (cw - width * scale) / 2 : 28;
      const y = height * scale <= ch ? (ch - height * scale) / 2 : 28;
      setTransform({ x, y, scale });
    };
    const raf = requestAnimationFrame(fit);
    const timers = [setTimeout(fit, 160), setTimeout(fit, 420)];
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', fit);
    };
  }, [hasContent, width, height]);

  // anime.js: connector draw-in, entrance, owned glow, counter.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (countRef.current) countRef.current.textContent = String(counts.owned);

    scopeRef.current = createScope({ root: rootRef }).add(() => {
      animate('[data-anim="overlay"]', {
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 500,
        delay: stagger(80),
        ease: 'outExpo',
      });
      if (reduced) return;

      const drawables = svg.createDrawable('.skill-edge');
      if (drawables.length) {
        animate(drawables, { draw: ['0 0', '0 1'], duration: 650, delay: stagger(18), ease: 'inOutSine' });
      }
      animate('.skill-node-inner', {
        opacity: [0, 1],
        scale: [0.6, 1],
        duration: 460,
        delay: stagger(24),
        ease: 'outBack',
      });
      animate('[data-owned="true"] .skill-glow', {
        opacity: [0.3, 0.6],
        scale: [1, 1.18],
        duration: 1900,
        loop: true,
        alternate: true,
        ease: 'inOutSine',
      });
      const counter = { n: 0 };
      animate(counter, {
        n: counts.owned,
        duration: 1100,
        ease: 'outExpo',
        modifier: utils.round(0),
        onUpdate: () => {
          if (countRef.current) countRef.current.textContent = String(Math.round(counter.n));
        },
      });
    });

    return () => scopeRef.current?.revert();
  }, [layout.placed.length, counts.owned]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isPanning.current = true;
    interactedRef.current = true;
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
    interactedRef.current = true;
    setTransform((t) => ({ ...t, scale: Math.min(1.8, Math.max(0.3, t.scale - e.deltaY * 0.001)) }));
  }, []);

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden bg-background" data-testid="skilltree-view">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-[16%] top-[14%] h-[40vw] max-h-[600px] w-[40vw] max-w-[600px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-[10%] right-[16%] h-[34vw] max-h-[520px] w-[34vw] max-w-[520px] rounded-full bg-secondary/20 blur-[120px]" />
      </div>

      {hasContent ? (
        <div
          className="absolute inset-0"
          style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <svg
            width={width}
            height={height}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
            }}
          >
            {layout.edges.map((e) => (
              <path
                key={e.id}
                className="skill-edge"
                d={edgePath(e.sx + offX, e.sy + offY, e.tx + offX, e.ty + offY)}
                fill="none"
                stroke={edgeColor(e.state)}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeOpacity={e.state === 'locked' ? 0.3 : 0.85}
              />
            ))}

            {layout.placed.map(({ node, x, y }) => {
              const sx = x + offX;
              const sy = y + offY;
              const expandable = !!node.children?.length;
              const isCollapsed = collapsed.has(node.id);
              return (
                <foreignObject key={node.id} x={sx - BOX_W / 2} y={sy - BOX_H / 2} width={BOX_W} height={BOX_H}>
                  <div className="relative h-full w-full">
                    <SkillNode
                      node={node}
                      clickable
                      selected={selectedId === node.id}
                      expandable={expandable}
                      collapsed={isCollapsed}
                      onClick={() => {
                        if (expandable) toggleCollapse(node.id);
                        setSelectedId(node.id);
                      }}
                    />
                  </div>
                </foreignObject>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <GitBranch className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-bold text-foreground">No skills to map yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Complete a lecture in any course to start unlocking your skill tree.
          </p>
        </div>
      )}

      {/* header */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4 md:p-6">
        <div data-anim="overlay" className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to dashboard"
            className="flex h-10 w-10 items-center justify-center rounded-xl glass-card border-white/10 text-muted-foreground hover:text-foreground cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="hidden glass-card border-white/10 rounded-xl px-4 py-2 sm:block">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Skill Tree</p>
            <p className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-xp" aria-hidden="true" />
              <span ref={countRef}>{counts.owned}</span>
              <span className="text-muted-foreground">/ {counts.total} mastered</span>
            </p>
          </div>
        </div>
        <div data-anim="overlay">
          <InsightsViewTabs view={view} onChange={onViewChange} />
        </div>
      </div>

      {/* legend + degraded note */}
      <div data-anim="overlay" className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2">
        <div className="flex items-center gap-4 glass-card border-white/10 rounded-xl px-4 py-2.5">
          {LEGEND.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${item.className}`} aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
        {!conceptsAvailable && (
          <p className="glass-card border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-muted-foreground">
            Concept skills not available yet — showing courses &amp; lectures.
          </p>
        )}
      </div>

      {/* info panel — keyed so it replays its enter animation on each selection */}
      {selected && (
        <aside
          key={selected.id}
          className="absolute right-4 top-1/2 z-20 w-72 -translate-y-1/2 glass-card border-white/10 rounded-2xl p-5 animate-in fade-in slide-in-from-right-4 duration-200"
          data-testid="skill-info-panel"
        >
          <SkillInfo node={selected} onClose={() => setSelectedId(null)} onOpenLecture={onOpenLecture} />
        </aside>
      )}
    </div>
  );
}

function SkillInfo({
  node,
  onClose,
  onOpenLecture,
}: {
  node: SkillNodeData;
  onClose: () => void;
  onOpenLecture: (id: string) => void;
}) {
  const kindLabel =
    node.kind === 'root'
      ? 'Overview'
      : node.kind === 'course'
        ? 'Course'
        : node.kind === 'lecture'
          ? 'Lecture'
          : 'Concept';

  let body: string;
  if (node.kind === 'root') {
    const n = node.children?.length ?? 0;
    body = n
      ? `${n} course${n === 1 ? '' : 's'} in your library — tap one to explore its lectures.`
      : 'Complete a lecture to start building your skill tree.';
  } else if (node.kind === 'course') {
    const m = node.meta;
    body = m ? `${m.owned} of ${m.total} lectures mastered.` : 'A course in your library.';
  } else if (node.kind === 'lecture') {
    body =
      node.state === 'locked'
        ? 'Locked — complete the previous lecture in this course to unlock it.'
        : node.desc?.trim() || 'A lecture in this course. Finish its quiz to master it.';
  } else {
    body =
      node.mastery && node.mastery.attempts > 0
        ? `${Math.round(node.mastery.score * 100)}% mastery over ${node.mastery.attempts} attempt${node.mastery.attempts === 1 ? '' : 's'}.`
        : node.state === 'locked'
          ? 'Locked — finish the lecture that teaches this concept.'
          : 'Not practised yet.';
  }

  const showProgress = node.state === 'in_progress' && typeof node.progress === 'number';
  const canOpen = node.kind === 'lecture' && !!node.lectureId && node.state !== 'locked';

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{kindLabel}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3 className="text-base font-bold leading-tight text-foreground">{node.label}</h3>

      <span
        className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${STATE_DOT[node.state]}`}
      >
        {node.state === 'locked' && <Lock className="h-3 w-3" />}
        {STATE_LABEL[node.state]}
      </span>

      {showProgress && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-secondary" style={{ width: `${Math.round((node.progress ?? 0) * 100)}%` }} />
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{body}</p>

      {canOpen && (
        <button
          type="button"
          onClick={() => onOpenLecture(node.lectureId!)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-4 py-2.5 text-xs font-bold text-white cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          Open lecture
          <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
