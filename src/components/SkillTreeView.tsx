/**
 * SkillTreeView — Assassin's Creed Origins-style constellation skill map.
 *
 * Full SVG-native rendering: no foreignObject, no HTML nodes inside SVG.
 * Layout: root at centre → courses fan out radially → lectures chain outward
 * along the branch angle → concepts sprout diagonally. Bokeh particle layer
 * animates in the background; edges glow; nodes pulse.
 *
 * Tech: anime.js for all animation, SVG for all rendering.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, createScope, stagger, svg, utils, type Scope } from 'animejs';
import { ChevronLeft, Sparkles, GitBranch, X, ArrowRight, Lock, BookOpen, GraduationCap, Lightbulb, Star } from 'lucide-react';
import { InsightsViewTabs, type InsightsView } from '@/components/InsightsViewTabs';
import type { SkillNode as SkillNodeData } from '@/features/skilltree/skillTree';

/* ─────────────────────────── Types ─────────────────────────── */
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

interface Placed {
  node: SkillNodeData;
  x: number;
  y: number;
  r: number; // node radius
}

interface Edge {
  id: string;
  sx: number; sy: number;
  tx: number; ty: number;
  owned: boolean;
  inProgress: boolean;
  available: boolean;
}

interface Particle {
  id: number;
  x: number; y: number;
  r: number;
  opacity: number;
  speed: number;
  angle: number;
}

/* ─────────────── Visual config ─────────────── */
// Node radii per kind
const RADII: Record<SkillNodeData['kind'], number> = {
  root: 36,
  course: 28,
  lecture: 20,
  'course-concept': 14,
  'lecture-concept': 13,
};

// Layout distances
const COURSE_DIST = 210;   // root → course
const LEC_STEP    = 155;   // between lectures
const CONCEPT_R   = 100;   // lecture → concept

// Gold palette  (matches AC Origins)
const GOLD       = '#D4A843';
const GOLD_GLOW  = 'rgba(212,168,67,0.55)';
const GOLD_DIM   = '#7A5F20';
const LOCKED_FILL = '#1A1E2B';
const LOCKED_RING = '#2D334A';
const AVAIL_RING  = '#3A4A7A';
const PROGRESS_RING = '#5A7ACA';

/* ─────────────────────── Layout ─────────────────────── */
function buildLayout(tree: SkillNodeData): { placed: Placed[]; edges: Edge[] } {
  const placed: Placed[] = [];
  const edges: Edge[] = [];

  placed.push({ node: tree, x: 0, y: 0, r: RADII.root });

  const courses = tree.children ?? [];
  const numC = courses.length;

  courses.forEach((course, ci) => {
    // Fan from top, evenly spaced
    const angle = numC === 1 ? -Math.PI / 2 : -Math.PI / 2 + (ci / numC) * Math.PI * 2;
    const cx = Math.cos(angle) * COURSE_DIST;
    const cy = Math.sin(angle) * COURSE_DIST;
    placed.push({ node: course, x: cx, y: cy, r: RADII.course });
    edges.push({
      id: `e-r-${course.id}`,
      sx: 0, sy: 0, tx: cx, ty: cy,
      owned: course.state === 'owned',
      inProgress: course.state === 'in_progress',
      available: course.state === 'available',
    });

    const lectures = (course.children ?? []).filter(n => n.kind === 'lecture');
    let prevX = cx;
    let prevY = cy;

    lectures.forEach((lec, li) => {
      const dist = COURSE_DIST + (li + 1) * LEC_STEP;
      const lx = Math.cos(angle) * dist;
      const ly = Math.sin(angle) * dist;
      placed.push({ node: lec, x: lx, y: ly, r: RADII.lecture });
      edges.push({
        id: `e-${lec.id}`,
        sx: prevX, sy: prevY, tx: lx, ty: ly,
        owned: lec.state === 'owned',
        inProgress: lec.state === 'in_progress',
        available: lec.state === 'available',
      });
      prevX = lx;
      prevY = ly;

      (lec.children ?? []).forEach((c, ki) => {
        const sign = ki % 2 === 0 ? 1 : -1;
        const cAngle = angle + sign * (Math.PI / 3.8) * (1 + Math.floor(ki / 2) * 0.25);
        const ctx = lx + Math.cos(cAngle) * CONCEPT_R;
        const cty = ly + Math.sin(cAngle) * CONCEPT_R;
        placed.push({ node: c, x: ctx, y: cty, r: RADII['lecture-concept'] });
        edges.push({
          id: `e-${c.id}`,
          sx: lx, sy: ly, tx: ctx, ty: cty,
          owned: c.state === 'owned',
          inProgress: c.state === 'in_progress',
          available: c.state === 'available',
        });
      });
    });
  });

  return { placed, edges };
}

/* ─────────────────────── Particles ─────────────────────── */
function genParticles(n: number, W: number, H: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.8 + 0.4,
    opacity: Math.random() * 0.55 + 0.1,
    speed: Math.random() * 0.18 + 0.04,
    angle: Math.random() * Math.PI * 2,
  }));
}

/* ─────────────────────── SVG helpers ─────────────────────── */
function edgeStroke(e: Edge) {
  if (e.owned) return GOLD;
  if (e.inProgress) return PROGRESS_RING;
  if (e.available) return AVAIL_RING;
  return LOCKED_RING;
}

function edgeOpacity(e: Edge) {
  if (e.owned) return 0.9;
  if (e.inProgress) return 0.6;
  if (e.available) return 0.4;
  return 0.18;
}

function nodeColors(node: SkillNodeData) {
  switch (node.state) {
    case 'owned':       return { fill: '#1A1610', ring: GOLD,         glow: GOLD_GLOW,  icon: GOLD };
    case 'in_progress': return { fill: '#111828', ring: PROGRESS_RING, glow: 'rgba(90,122,202,0.4)', icon: '#8AABF0' };
    case 'available':   return { fill: '#121620', ring: AVAIL_RING,   glow: 'rgba(58,74,122,0.3)',  icon: '#6A88C8' };
    default:            return { fill: LOCKED_FILL, ring: LOCKED_RING, glow: 'none',    icon: '#4A5068' };
  }
}

/* ─────────── Info-panel labels ─────────── */
const STATE_LABEL: Record<SkillNodeData['state'], string> = {
  locked: 'Locked', available: 'Available', in_progress: 'In Progress', owned: 'Mastered',
};

/* ─────────── Icon paths (simplified lucide-style, 24×24 viewBox) ─────────── */
// We embed simplified icon paths to avoid foreignObject
function KindIconPath({ kind }: { kind: SkillNodeData['kind'] }) {
  switch (kind) {
    case 'root':
      // Sparkles simplified
      return <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z" fill="currentColor" />;
    case 'course':
      // GraduationCap
      return <path d="M22 10v6M2 10l10-5 10 5-10 5z M6 12v5c3 3 9 3 12 0v-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
    case 'lecture':
      // BookOpen
      return <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
    default:
      // Lightbulb
      return <path d="M9 21h6 M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.1-3 5.2V17H9v-2.8C7.2 13.1 6 11.2 6 9a6 6 0 0 1 6-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
  }
}

/* ═══════════════════ Main component ═══════════════════ */
export function SkillTreeView({
  tree, counts, conceptsAvailable, hasContent,
  view, onViewChange, onOpenLecture, onBack,
}: Props) {
  const rootRef   = useRef<HTMLDivElement>(null);
  const svgRef    = useRef<SVGSVGElement>(null);
  const scopeRef  = useRef<Scope | null>(null);
  const countRef  = useRef<HTMLSpanElement>(null);
  const pBuf      = useRef<Particle[]>([]);
  const rafRef    = useRef<number>(0);
  const particleSvgRef = useRef<SVGGElement>(null);

  const didInteract  = useRef(false);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.85 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [dim, setDim] = useState({ w: 1200, h: 800 });

  /* ── layout ── */
  const { placed, edges } = useMemo(() => buildLayout(tree), [tree]);

  const xs = placed.map(p => p.x);
  const ys = placed.map(p => p.y);
  const minX = Math.min(...xs) - 120;
  const maxX = Math.max(...xs) + 120;
  const minY = Math.min(...ys) - 120;
  const maxY = Math.max(...ys) + 120;
  const svgW = maxX - minX;
  const svgH = maxY - minY;
  const offX = -minX;
  const offY = -minY;

  const selected = useMemo(
    () => placed.find(p => p.node.id === selectedId) ?? null,
    [placed, selectedId],
  );

  /* ── fit on mount / content change ── */
  useEffect(() => {
    if (!hasContent) return;
    const fit = () => {
      if (didInteract.current) return;
      const el = rootRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      setDim({ w: cw, h: ch });
      const scale = Math.max(0.35, Math.min(1.1, Math.min(cw / svgW, ch / svgH) * 0.88));
      const x = (cw - svgW * scale) / 2;
      const y = (ch - svgH * scale) / 2;
      setTransform({ x, y, scale });
    };
    const raf = requestAnimationFrame(fit);
    const t1 = setTimeout(fit, 100);
    const t2 = setTimeout(fit, 400);
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', fit); };
  }, [hasContent, svgW, svgH]);

  /* ── Bokeh particle system ── */
  useEffect(() => {
    if (!hasContent) return;
    const el = rootRef.current;
    if (!el) return;
    const W = el.clientWidth || 1200;
    const H = el.clientHeight || 800;
    pBuf.current = genParticles(90, W, H);

    const tick = () => {
      pBuf.current.forEach(p => {
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;
      });
      const g = particleSvgRef.current;
      if (g) {
        const circles = g.querySelectorAll('circle');
        circles.forEach((c, i) => {
          const p = pBuf.current[i];
          if (!p) return;
          c.setAttribute('cx', String(p.x));
          c.setAttribute('cy', String(p.y));
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [hasContent]);

  /* ── anime.js: edge draw-in, node entrance, owned glow, counter ── */
  useEffect(() => {
    if (!hasContent) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (countRef.current) countRef.current.textContent = String(counts.owned);

    scopeRef.current = createScope({ root: rootRef }).add(() => {
      animate('[data-anim="ui"]', {
        opacity: [0, 1], translateY: [10, 0],
        duration: 500, delay: stagger(70), ease: 'outExpo',
      });

      if (reduced) return;

      const drawables = svg.createDrawable('.sk-edge');
      if (drawables.length) {
        animate(drawables, { draw: ['0 0', '0 1'], duration: 800, delay: stagger(20), ease: 'inOutSine' });
      }

      animate('.sk-node-circle', {
        opacity: [0, 1], scale: [0.4, 1],
        duration: 500, delay: stagger(28, { from: 'center' }), ease: 'outBack(1.4)',
      });

      animate('.sk-node-glow', {
        opacity: [0.4, 0.85], scale: [0.9, 1.2],
        duration: 2200, loop: true, alternate: true, ease: 'inOutSine',
      });

      animate('.sk-label', {
        opacity: [0, 1], translateY: [6, 0],
        duration: 400, delay: stagger(20, { start: 300 }), ease: 'outExpo',
      });

      if (countRef.current) {
        const counter = { n: 0 };
        animate(counter, {
          n: counts.owned, duration: 1200, ease: 'outExpo',
          modifier: utils.round(0),
          onUpdate: () => {
            if (countRef.current) countRef.current.textContent = String(Math.round(counter.n));
          },
        });
      }
    });

    return () => scopeRef.current?.revert();
  }, [placed.length, counts.owned, hasContent]);



  /* ── Filter defs IDs ── */
  const GLOW_GOLD     = 'sk-glow-gold';
  const GLOW_BLUE     = 'sk-glow-blue';
  const GLOW_LOCKED   = 'sk-glow-locked';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: 'radial-gradient(ellipse at 50% 60%, #0D1020 0%, #060810 100%)' }}
      data-testid="skilltree-view"
    >
      {/* ── Bokeh particle layer ── */}
      <svg
        className="pointer-events-none absolute inset-0"
        width="100%" height="100%"
        aria-hidden="true"
      >
        <g ref={particleSvgRef}>
          {Array.from({ length: 90 }, (_, i) => (
            <circle
              key={i}
              cx={Math.random() * 1200}
              cy={Math.random() * 800}
              r={Math.random() * 1.8 + 0.3}
              fill={i % 5 === 0 ? GOLD : 'white'}
              opacity={Math.random() * 0.4 + 0.08}
            />
          ))}
        </g>
      </svg>

      {/* ── Atmospheric glows ── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div style={{ position: 'absolute', left: '20%', top: '25%', width: 480, height: 480, borderRadius: '50%', background: 'rgba(212,168,67,0.04)', filter: 'blur(100px)' }} />
        <div style={{ position: 'absolute', right: '15%', bottom: '20%', width: 380, height: 380, borderRadius: '50%', background: 'rgba(80,100,200,0.06)', filter: 'blur(90px)' }} />
        <div style={{ position: 'absolute', left: '40%', top: '40%', width: 260, height: 260, borderRadius: '50%', background: 'rgba(212,168,67,0.03)', filter: 'blur(80px)' }} />
      </div>

      {/* ── Main SVG skill tree ── */}
      {hasContent ? (
        <div className="absolute inset-0">
          <svg
            ref={svgRef}
            width={svgW}
            height={svgH}
            style={{
              transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
              overflow: 'visible',
            }}
          >
            <defs>
              {/* Gold glow filter */}
              <filter id={GLOW_GOLD} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feFlood floodColor={GOLD} floodOpacity="0.7" result="color" />
                <feComposite in="color" in2="blur" operator="in" result="glow" />
                <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              {/* Blue glow */}
              <filter id={GLOW_BLUE} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feFlood floodColor="#5A7ACA" floodOpacity="0.6" result="color" />
                <feComposite in="color" in2="blur" operator="in" result="glow" />
                <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              {/* Locked subtle glow */}
              <filter id={GLOW_LOCKED} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              {/* Edge gradient */}
              <linearGradient id="edge-gold-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={GOLD_DIM} />
                <stop offset="100%" stopColor={GOLD} />
              </linearGradient>
            </defs>

            {/* ── Edges ── */}
            <g>
              {edges.map(e => {
                const stroke = edgeStroke(e);
                const op     = edgeOpacity(e);
                const sw     = e.owned ? 2.5 : 1.8;
                const filter = e.owned ? `url(#${GLOW_GOLD})` : undefined;
                return (
                  <line
                    key={e.id}
                    className="sk-edge"
                    x1={e.sx + offX} y1={e.sy + offY}
                    x2={e.tx + offX} y2={e.ty + offY}
                    stroke={stroke}
                    strokeWidth={sw}
                    strokeOpacity={op}
                    strokeLinecap="round"
                    filter={filter}
                  />
                );
              })}
            </g>

            {/* ── Nodes ── */}
            <g>
              {placed.map(({ node, x, y, r }) => {
                const nx = x + offX;
                const ny = y + offY;
                const colors = nodeColors(node);
                const isOwned = node.state === 'owned';
                const isLocked = node.state === 'locked';
                const isSelected = selectedId === node.id;
                const isHovered = hoveredId === node.id;
                const glowFilter = isOwned ? `url(#${GLOW_GOLD})` : node.state === 'in_progress' ? `url(#${GLOW_BLUE})` : undefined;
                const ringW = isSelected ? 3 : isHovered ? 2 : 1.5;
                const ringColor = isSelected ? '#FFFFFF' : colors.ring;
                const scaledR = isHovered && !isSelected ? r * 1.08 : r;

                // Icon scale
                const iconScale = (r * 0.7) / 12; // 12 = half of 24px viewBox

                return (
                  <g
                    key={node.id}
                    transform={`translate(${nx},${ny})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedId(prev => prev === node.id ? null : node.id)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    role="button"
                    aria-label={`${node.label} — ${node.state.replace('_', ' ')}`}
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(prev => prev === node.id ? null : node.id); } }}
                  >
                    {/* Outer glow ring (owned/in-progress only) */}
                    {!isLocked && (
                      <circle
                        className="sk-node-glow"
                        r={scaledR + 10}
                        fill="none"
                        stroke={colors.ring}
                        strokeWidth={1}
                        strokeOpacity={isOwned ? 0.55 : 0.25}
                        filter={glowFilter}
                      />
                    )}

                    {/* Selection ring */}
                    {isSelected && (
                      <circle
                        r={scaledR + 6}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        strokeOpacity={0.6}
                        strokeDasharray="4 3"
                      />
                    )}

                    {/* Main circle */}
                    <circle
                      className="sk-node-circle"
                      r={scaledR}
                      fill={colors.fill}
                      stroke={ringColor}
                      strokeWidth={ringW}
                      filter={isOwned ? `url(#${GLOW_GOLD})` : isLocked ? `url(#${GLOW_LOCKED})` : undefined}
                    />

                    {/* Inner decorative ring (for larger nodes) */}
                    {r >= 20 && (
                      <circle
                        r={scaledR * 0.72}
                        fill="none"
                        stroke={colors.ring}
                        strokeWidth={0.8}
                        strokeOpacity={0.35}
                      />
                    )}

                    {/* Progress arc (in_progress nodes) */}
                    {node.state === 'in_progress' && typeof node.progress === 'number' && (
                      (() => {
                        const pct = node.progress;
                        const circumference = 2 * Math.PI * (scaledR + 4);
                        const dash = pct * circumference;
                        return (
                          <circle
                            r={scaledR + 4}
                            fill="none"
                            stroke={PROGRESS_RING}
                            strokeWidth={2.5}
                            strokeOpacity={0.8}
                            strokeDasharray={`${dash} ${circumference - dash}`}
                            strokeLinecap="round"
                            transform="rotate(-90)"
                          />
                        );
                      })()
                    )}

                    {/* Icon */}
                    <g
                      transform={`translate(${-12 * iconScale},${-12 * iconScale}) scale(${iconScale})`}
                      style={{ color: colors.icon }}
                      opacity={isLocked ? 0.45 : 1}
                    >
                      <svg viewBox="0 0 24 24" width={24} height={24}>
                        <KindIconPath kind={node.kind} />
                      </svg>
                    </g>

                    {/* Lock badge */}
                    {isLocked && (
                      <g transform={`translate(${scaledR * 0.6},${-scaledR * 0.6})`}>
                        <circle r={7} fill="#0D1020" stroke={LOCKED_RING} strokeWidth={1} />
                        <g transform="translate(-5,-5) scale(0.42)">
                          <svg viewBox="0 0 24 24" width={24} height={24}>
                            <rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke={LOCKED_RING} strokeWidth="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke={LOCKED_RING} strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </g>
                      </g>
                    )}

                    {/* Owned checkmark badge */}
                    {isOwned && (
                      <g transform={`translate(${scaledR * 0.6},${-scaledR * 0.6})`}>
                        <circle r={7} fill="#1A1610" stroke={GOLD} strokeWidth={1.5} />
                        <g transform="translate(-5,-5) scale(0.42)">
                          <svg viewBox="0 0 24 24" width={24} height={24}>
                            <polyline points="20 6 9 17 4 12" fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </g>
                      </g>
                    )}

                    {/* Label */}
                    <text
                      className="sk-label"
                      y={scaledR + 16}
                      textAnchor="middle"
                      fill={isLocked ? '#4A5068' : isOwned ? GOLD : '#B0BCDF'}
                      fontSize={node.kind === 'root' ? 13 : node.kind === 'course' ? 11 : 10}
                      fontWeight={node.kind === 'root' || isOwned ? '700' : '500'}
                      fontFamily="Inter, system-ui, sans-serif"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {/* Truncate label for display */}
                      {node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label}
                    </text>

                    {/* Course label above for course kind */}
                    {node.kind === 'course' && (
                      <text
                        y={-scaledR - 10}
                        textAnchor="middle"
                        fill="#6070A0"
                        fontSize={8}
                        fontWeight="700"
                        letterSpacing="2"
                        fontFamily="Inter, system-ui, sans-serif"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        COURSE
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      ) : (
        /* Empty state */
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div style={{ width: 64, height: 64, borderRadius: '50%', border: `2px solid ${LOCKED_RING}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GitBranch style={{ width: 28, height: 28, color: '#4A5068' }} />
          </div>
          <p style={{ color: '#E0E8FF', fontWeight: 700, fontSize: 15, margin: 0 }}>No skills to map yet</p>
          <p style={{ color: '#4A5068', fontSize: 12, maxWidth: 280, margin: 0 }}>
            Complete a lecture in any course to start unlocking your skill constellation.
          </p>
        </div>
      )}

      {/* ── Header UI ── */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4 md:p-6">
        <div data-anim="ui" className="flex items-center gap-3" style={{ opacity: 0 }}>
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to dashboard"
            style={{
              display: 'flex', width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
              borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#6070A0', cursor: 'pointer', transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#E0E8FF')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6070A0')}
          >
            <ChevronLeft style={{ width: 20, height: 20 }} aria-hidden="true" />
          </button>

          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '8px 16px',
          }}>
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: GOLD, textTransform: 'uppercase', margin: '0 0 3px' }}>
              Skill Constellation
            </p>
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#E0E8FF', margin: 0 }}>
              <Sparkles style={{ width: 14, height: 14, color: GOLD }} aria-hidden="true" />
              <span ref={countRef} style={{ color: GOLD }}>{counts.owned}</span>
              <span style={{ color: '#4A5068' }}>/ {counts.total} mastered</span>
            </p>
          </div>
        </div>

        <div data-anim="ui" style={{ opacity: 0 }}>
          <InsightsViewTabs view={view} onChange={onViewChange} />
        </div>
      </div>

      {/* ── Bottom legend ── */}
      <div data-anim="ui" className="absolute bottom-4 left-4 z-10" style={{ opacity: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 20,
          background: 'rgba(10,12,20,0.75)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: '8px 16px', backdropFilter: 'blur(12px)',
        }}>
          {[
            { label: 'Mastered', color: GOLD },
            { label: 'In Progress', color: PROGRESS_RING },
            { label: 'Available', color: AVAIL_RING },
            { label: 'Locked', color: LOCKED_RING },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#4A5068', textTransform: 'uppercase' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Info panel ── */}
      {selected && (
        <InfoPanel
          key={selected.node.id}
          node={selected.node}
          onClose={() => setSelectedId(null)}
          onOpenLecture={onOpenLecture}
        />
      )}
    </div>
  );
}

/* ═══════════════════ Info Panel ═══════════════════ */
function InfoPanel({
  node,
  onClose,
  onOpenLecture,
}: {
  node: SkillNodeData;
  onClose: () => void;
  onOpenLecture: (id: string) => void;
}) {
  const kindLabel =
    node.kind === 'root' ? 'Overview'
    : node.kind === 'course' ? 'Course'
    : node.kind === 'lecture' ? 'Lecture'
    : 'Concept';

  let body = '';
  if (node.kind === 'root') {
    const n = node.children?.length ?? 0;
    body = n ? `${n} course${n === 1 ? '' : 's'} in your library.` : 'Complete a lecture to build your skill constellation.';
  } else if (node.kind === 'course') {
    const m = node.meta;
    body = m ? `${m.owned} of ${m.total} lectures mastered.` : 'A course in your library.';
  } else if (node.kind === 'lecture') {
    body = node.state === 'locked'
      ? 'Locked — complete the previous lecture to unlock it.'
      : node.desc?.trim() || 'Finish this lecture\'s quiz to master it.';
  } else {
    body = node.mastery && node.mastery.attempts > 0
      ? `${Math.round(node.mastery.score * 100)}% mastery · ${node.mastery.attempts} attempt${node.mastery.attempts === 1 ? '' : 's'}.`
      : node.state === 'locked'
        ? 'Locked — finish the parent lecture first.'
        : 'Not practised yet.';
  }

  const isOwned   = node.state === 'owned';
  const isLocked  = node.state === 'locked';
  const showProg  = node.state === 'in_progress' && typeof node.progress === 'number';
  const canOpen   = node.kind === 'lecture' && !!node.lectureId && !isLocked;
  const colors    = nodeColors(node);

  const stateBadge: Record<SkillNodeData['state'], { bg: string; color: string; label: string }> = {
    owned:       { bg: 'rgba(212,168,67,0.15)',  color: GOLD,           label: '✦ Mastered'     },
    in_progress: { bg: 'rgba(90,122,202,0.15)',   color: PROGRESS_RING, label: '◑ In Progress'  },
    available:   { bg: 'rgba(58,74,122,0.2)',     color: AVAIL_RING,    label: '◯ Available'    },
    locked:      { bg: 'rgba(45,51,74,0.3)',      color: '#4A5068',     label: '⊘ Locked'       },
  };
  const badge = stateBadge[node.state];

  return (
    <aside
      data-testid="skill-info-panel"
      style={{
        position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
        width: 280, zIndex: 20,
        background: 'rgba(8,10,18,0.92)',
        border: `1px solid ${isOwned ? 'rgba(212,168,67,0.35)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 16, padding: 20,
        backdropFilter: 'blur(20px)',
        boxShadow: isOwned
          ? `0 0 40px rgba(212,168,67,0.12), 0 8px 32px rgba(0,0,0,0.5)`
          : `0 8px 32px rgba(0,0,0,0.5)`,
        animation: 'sk-panel-in 0.22s ease-out both',
      }}
    >
      <style>{`
        @keyframes sk-panel-in {
          from { opacity: 0; transform: translateY(-50%) translateX(12px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.25em', color: '#4A5068', textTransform: 'uppercase' }}>
          {kindLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            display: 'flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, background: 'none', border: 'none', color: '#4A5068', cursor: 'pointer', transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#E0E8FF')}
          onMouseLeave={e => (e.currentTarget.style.color = '#4A5068')}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Title */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: isOwned ? GOLD : '#E0E8FF', margin: '0 0 10px', lineHeight: 1.3 }}>
        {node.label}
      </h3>

      {/* State badge */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: badge.bg, color: badge.color,
        borderRadius: 20, padding: '4px 10px',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        marginBottom: 12,
      }}>
        {badge.label}
      </span>

      {/* Progress bar */}
      {showProg && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              width: `${Math.round((node.progress ?? 0) * 100)}%`,
              background: `linear-gradient(90deg, ${AVAIL_RING}, ${PROGRESS_RING})`,
            }} />
          </div>
          <p style={{ fontSize: 10, color: '#4A5068', margin: '4px 0 0', textAlign: 'right' }}>
            {Math.round((node.progress ?? 0) * 100)}% complete
          </p>
        </div>
      )}

      {/* Mastery bar for concepts */}
      {(node.kind === 'lecture-concept' || node.kind === 'course-concept') && node.mastery && node.mastery.attempts > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: '#4A5068', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Mastery</span>
            <span style={{ fontSize: 9, color: isOwned ? GOLD : '#6070A0', fontWeight: 700 }}>
              {Math.round(node.mastery.score * 100)}%
            </span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${Math.round(node.mastery.score * 100)}%`,
              background: isOwned ? `linear-gradient(90deg, ${GOLD_DIM}, ${GOLD})` : `linear-gradient(90deg, ${AVAIL_RING}, ${PROGRESS_RING})`,
            }} />
          </div>
        </div>
      )}

      {/* Body */}
      <p style={{ fontSize: 12, color: '#6070A0', lineHeight: 1.6, margin: '0 0 14px' }}>
        {body}
      </p>

      {/* Divider */}
      <div style={{ height: 1, background: isOwned ? 'rgba(212,168,67,0.12)' : 'rgba(255,255,255,0.05)', marginBottom: 14 }} />

      {/* Open lecture CTA */}
      {canOpen && (
        <button
          type="button"
          onClick={() => onOpenLecture(node.lectureId!)}
          style={{
            display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: `linear-gradient(135deg, ${GOLD_DIM}, ${GOLD})`,
            border: 'none', borderRadius: 10, padding: '10px 0',
            color: '#0D1020', fontSize: 12, fontWeight: 800, cursor: 'pointer',
            letterSpacing: '0.05em', textTransform: 'uppercase',
            boxShadow: `0 0 20px rgba(212,168,67,0.25)`,
            transition: 'opacity 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.boxShadow = `0 0 30px rgba(212,168,67,0.4)`; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.boxShadow = `0 0 20px rgba(212,168,67,0.25)`; }}
        >
          Open Lecture
          <ArrowRight style={{ width: 14, height: 14 }} />
        </button>
      )}
    </aside>
  );
}
