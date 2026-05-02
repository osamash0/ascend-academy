import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TreeNode } from '@/features/mindmap/hooks/useMindMap';

// ─── Layout Engine ──────────────────────────────────────────────────────────

interface PositionedNode extends TreeNode {
  x: number;
  y: number;
  width: number;
  height: number;
  children?: PositionedNode[];
}

const NODE_W: Record<string, number> = { root: 160, cluster: 140, slide: 130, concept: 110 };
const NODE_H: Record<string, number> = { root: 56, cluster: 44, slide: 40, concept: 32 };
const H_GAP = 80;
const V_GAP = 16;

/** Recursively compute subtree height */
function subtreeHeight(node: TreeNode, collapsed: Set<string>): number {
  const h = NODE_H[node.type] ?? 36;
  if (!node.children?.length || collapsed.has(node.id)) return h;
  const childrenH = node.children.reduce(
    (sum, c, i) => sum + subtreeHeight(c, collapsed) + (i > 0 ? V_GAP : 0),
    0
  );
  return Math.max(h, childrenH);
}

/** Assign x,y positions */
function positionNode(
  node: TreeNode,
  x: number,
  y: number,
  collapsed: Set<string>
): PositionedNode {
  const w = NODE_W[node.type] ?? 120;
  const h = NODE_H[node.type] ?? 36;

  if (!node.children?.length || collapsed.has(node.id)) {
    return { ...node, x, y, width: w, height: h, children: [] };
  }

  const childX = x + w + H_GAP;
  const totalChildH = node.children.reduce(
    (sum, c, i) => sum + subtreeHeight(c, collapsed) + (i > 0 ? V_GAP : 0),
    0
  );

  const startY = y + h / 2 - totalChildH / 2;
  const positioned: PositionedNode[] = [];
  let curY = startY;

  for (const child of node.children) {
    const childH = subtreeHeight(child, collapsed);
    const pos = positionNode(child, childX, curY + childH / 2 - (NODE_H[child.type] ?? 36) / 2, collapsed);
    positioned.push(pos);
    curY += childH + V_GAP;
  }

  return { ...node, x, y, width: w, height: h, children: positioned };
}

function flatten(node: PositionedNode): PositionedNode[] {
  return [node, ...(node.children?.flatMap(flatten) ?? [])];
}

function edges(node: PositionedNode): { from: PositionedNode; to: PositionedNode }[] {
  return (node.children ?? []).flatMap((c) => [{ from: node, to: c }, ...edges(c)]);
}

function edgePath(from: PositionedNode, to: PositionedNode) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

const nodeStyles: Record<string, { fill: string; stroke: string; text: string; rx: number }> = {
  root:    { fill: 'from-primary to-secondary',      stroke: 'hsl(var(--primary))',   text: 'text-white',         rx: 28 },
  cluster: { fill: 'from-secondary/60 to-primary/40', stroke: 'hsl(var(--secondary))', text: 'text-foreground',    rx: 20 },
  slide:   { fill: 'from-surface-2 to-surface-1',    stroke: 'hsl(var(--border))',    text: 'text-foreground',    rx: 12 },
  concept: { fill: 'from-xp/20 to-warning/10',       stroke: 'hsl(var(--xp))',        text: 'text-muted-foreground', rx: 99 },
};

// ─── Memoized Node Component ────────────────────────────────────────────────

interface NodeRectProps {
  node: PositionedNode;
  isActive: boolean;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
  onHover: (node: PositionedNode | null) => void;
}

const NodeRect = React.memo(function NodeRect({
  node,
  isActive,
  isCollapsed,
  onToggle,
  onHover,
}: NodeRectProps) {
  const s = nodeStyles[node.type] ?? nodeStyles.concept;
  const hasChildren = (node.children?.length ?? 0) > 0 || isCollapsed;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      onClick={() => hasChildren && onToggle(node.id)}
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
    >
      {isActive && (
        <motion.rect
          x={node.x - 4}
          y={node.y - 4}
          width={node.width + 8}
          height={node.height + 8}
          rx={s.rx + 4}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeDasharray="6 3"
          animate={{ strokeDashoffset: [0, -18] }}
          transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
        />
      )}

      <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}>
        <div
          className={`w-full h-full flex items-center justify-center rounded-full bg-gradient-to-r ${s.fill} border`}
          style={{
            borderRadius: s.rx,
            borderColor: s.stroke,
            borderWidth: isActive ? 2 : 1,
            boxShadow: isActive ? `0 0 12px ${s.stroke}55` : undefined,
          }}
        >
          <span className={`text-[10px] font-bold px-2 text-center leading-tight ${s.text} truncate w-full text-center`}>
            {node.label}
          </span>
        </div>
      </foreignObject>

      {isCollapsed && (
        <text
          x={node.x + node.width + 6}
          y={node.y + node.height / 2 + 4}
          fontSize={10}
          fill="hsl(var(--muted-foreground))"
        >
          ▸
        </text>
      )}
    </motion.g>
  );
});

// ─── Main component ─────────────────────────────────────────────────────────

interface MindMapProps {
  treeData: TreeNode;
  currentSlideId?: string;
  height?: number;
}

export function MindMap({ treeData, currentSlideId, height = 460 }: MindMapProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<PositionedNode | null>(null);
  const [transform, setTransform] = useState({ x: 24, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const rafId = useRef<number | null>(null);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Memoize layout computation
  const layout = useMemo(() => {
    const positioned = positionNode(treeData, 24, 24, collapsed);
    const allNodes = flatten(positioned);
    const allEdges = edges(positioned);
    const maxX = Math.max(...allNodes.map((n) => n.x + n.width)) + 32;
    const maxY = Math.max(...allNodes.map((n) => n.y + n.height)) + 32;
    return { positioned, allNodes, allEdges, maxX, maxY };
  }, [treeData, collapsed]);

  // Debounced hover handler
  const handleHover = useCallback((node: PositionedNode | null) => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      setHovered(node);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

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
    setTransform((t) => ({ ...t, scale: Math.min(2, Math.max(0.3, t.scale + delta)) }));
  }, []);

  const resetView = useCallback(() => setTransform({ x: 24, y: 0, scale: 1 }), []);
  const zoomIn = useCallback(() => setTransform((t) => ({ ...t, scale: Math.min(2, t.scale + 0.15) })), []);
  const zoomOut = useCallback(() => setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale - 0.15) })), []);

  return (
    <div className="relative select-none" style={{ height }}>
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <button onClick={zoomIn} className="w-8 h-8 glass-card border-white/10 rounded-lg text-muted-foreground hover:text-foreground text-sm font-bold flex items-center justify-center transition-colors" aria-label="Zoom in">+</button>
        <button onClick={zoomOut} className="w-8 h-8 glass-card border-white/10 rounded-lg text-muted-foreground hover:text-foreground text-sm font-bold flex items-center justify-center transition-colors" aria-label="Zoom out">−</button>
        <button onClick={resetView} className="px-3 h-8 glass-card border-white/10 rounded-lg text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase tracking-widest transition-colors">Reset</button>
      </div>

      <p className="absolute bottom-3 left-3 z-10 text-[9px] text-muted-foreground/40 uppercase tracking-widest pointer-events-none">
        Drag to pan · Scroll to zoom · Click nodes to expand
      </p>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ cursor: isPanning.current ? 'grabbing' : 'grab', overflow: 'hidden' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {layout.allEdges.map(({ from, to }, i) => (
            <motion.path
              key={`edge-${from.id}-${to.id}`}
              d={edgePath(from, to)}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={1.5}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.4, delay: i * 0.02 }}
            />
          ))}

          <AnimatePresence mode="popLayout">
            {layout.allNodes.map((node) => (
              <NodeRect
                key={node.id}
                node={node}
                isActive={!!currentSlideId && node.id === currentSlideId}
                isCollapsed={collapsed.has(node.id)}
                onToggle={toggleCollapse}
                onHover={handleHover}
              />
            ))}
          </AnimatePresence>
        </g>
      </svg>

      <AnimatePresence>
        {hovered?.summary && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 max-w-[220px] glass-panel-strong border-primary/20 p-3 rounded-xl shadow-2xl text-xs text-muted-foreground pointer-events-none"
            style={{
              left: (hovered.x + hovered.width / 2) * transform.scale + transform.x,
              top: hovered.y * transform.scale + transform.y - 12,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <p className="font-bold text-foreground mb-1 text-[11px]">{hovered.label}</p>
            <p>{hovered.summary}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
           onHover={handleHover}
              />
            ))}
          </AnimatePresence>
        </g>
      </svg>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered?.summary && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 max-w-[220px] glass-panel-strong border-primary/20 p-3 rounded-xl shadow-2xl text-xs text-muted-foreground pointer-events-none"
            style={{
              left: (hovered.x + hovered.width / 2) * transform.scale + transform.x,
              top: hovered.y * transform.scale + transform.y - 12,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <p className="font-bold text-foreground mb-1 text-[11px]">{hovered.label}</p>
            <p>{hovered.summary}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
