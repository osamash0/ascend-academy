/**
 * SkillTreeView — AC Origins-style constellation skill map.
 *
 * Layout: root at centre → courses fan out in an upper arc → each course
 * distributes its lectures in a 3-column grid (rows march outward, columns
 * spread perpendicular to the course direction). This keeps the tree 2-D and
 * balanced regardless of lecture count.
 *
 * Scaling: SVG viewBox + preserveAspectRatio="xMidYMid meet" — the browser
 * handles fit-to-container natively with zero JS arithmetic.
 *
 * Visuals: dark galaxy background, floating bokeh, glowing SVG-native edges
 * and nodes, gold AC-Origins palette. anime.js for entrance + glow pulse.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, createScope, stagger, svg, utils, type Scope } from 'animejs';
import { ChevronLeft, Sparkles, GitBranch, X, ArrowRight } from 'lucide-react';
import { InsightsViewTabs, type InsightsView } from '@/components/InsightsViewTabs';
import { countSkills, type SkillNode as SkillNodeData } from '@/features/skilltree/skillTree';

/* ─── props ─── */
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

/* ─── internal ─── */
interface Placed { node: SkillNodeData; x: number; y: number; r: number }
interface Edge   { id: string; sx: number; sy: number; tx: number; ty: number; state: SkillNodeData['state'] }

/* ─── visual constants ─── */
const RADII: Record<SkillNodeData['kind'], number> = {
  root: 40, course: 32, lecture: 22, 'course-concept': 15, 'lecture-concept': 13,
};

const GOLD         = '#D4A843';
const GOLD_DIM     = '#7A5F20';
const GOLD_GLOW    = 'rgba(212,168,67,0.5)';
const LOCKED_FILL  = '#111523';
const LOCKED_RING  = '#252B40';
const AVAIL_RING   = '#344070';
const PROG_RING    = '#4A6AB8';
const PROG_COL     = '#6A8AD8';
const BG_DARK      = '#060810';

/* ─── layout constants ─── */
const COURSE_DIST  = 200;   // root → course radius
const GRID_ROW_H   = 155;   // distance between lecture rows
const GRID_COL_W   = 160;   // distance between lecture columns
const GRID_COLS    = 3;     // columns per course
const CONCEPT_D    = 90;    // lecture → concept offset

/* ══════════════════════════════════════════
   Layout: 3-column grid per course
   ══════════════════════════════════════════ */
function buildLayout(tree: SkillNodeData) {
  const placed: Placed[] = [];
  const edges: Edge[] = [];

  placed.push({ node: tree, x: 0, y: 0, r: RADII.root });

  const courses = tree.children ?? [];
  const numC = courses.length;

  courses.forEach((course, ci) => {
    /* Fan courses in the upper 240° arc so branches spread sideways, not
       just up-and-down, keeping the tree 2-D for any count of courses. */
    const span   = numC <= 1 ? 0 : Math.min(Math.PI * 1.35, (numC - 1) * (Math.PI / 2.5));
    const base   = -Math.PI / 2;
    const angle  = numC <= 1 ? base : base - span / 2 + (ci / (numC - 1)) * span;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    // perpendicular (left-hand normal)
    const cosP = Math.cos(angle + Math.PI / 2);
    const sinP = Math.sin(angle + Math.PI / 2);

    const cx = cosA * COURSE_DIST;
    const cy = sinA * COURSE_DIST;
    placed.push({ node: course, x: cx, y: cy, r: RADII.course });
    edges.push({ id: `er-${course.id}`, sx: 0, sy: 0, tx: cx, ty: cy, state: course.state });

    const lectures = (course.children ?? []).filter(n => n.kind === 'lecture');

    let prevLecX = cx;
    let prevLecY = cy;

    lectures.forEach((lec, li) => {
      const col    = li % GRID_COLS;                          // 0 1 2 0 1 2 …
      const row    = Math.floor(li / GRID_COLS) + 1;         // 1 1 1 2 2 2 …
      const colOff = (col - (GRID_COLS - 1) / 2) * GRID_COL_W; // -160 0 +160
      const distOut = COURSE_DIST + row * GRID_ROW_H;

      const lx = cosA * distOut + cosP * colOff;
      const ly = sinA * distOut + sinP * colOff;

      placed.push({ node: lec, x: lx, y: ly, r: RADII.lecture });

      /* Connect sequentially so the "path" meaning is preserved */
      edges.push({ id: `el-${lec.id}`, sx: prevLecX, sy: prevLecY, tx: lx, ty: ly, state: lec.state });

      prevLecX = lx;
      prevLecY = ly;

      /* Concepts: branch diagonally from this lecture */
      (lec.children ?? []).slice(0, 4).forEach((c, ki) => {
        const sign   = ki % 2 === 0 ? 1 : -1;
        const cAngle = angle + sign * (Math.PI / 4) * (1 + Math.floor(ki / 2) * 0.2);
        const ctx    = lx + Math.cos(cAngle) * CONCEPT_D;
        const cty    = ly + Math.sin(cAngle) * CONCEPT_D;
        placed.push({ node: c, x: ctx, y: cty, r: RADII['lecture-concept'] });
        edges.push({ id: `ec-${c.id}`, sx: lx, sy: ly, tx: ctx, ty: cty, state: c.state });
      });
    });
  });

  const PAD  = 110;
  const allX = placed.map(p => p.x);
  const allY = placed.map(p => p.y);
  return {
    placed, edges,
    minX: Math.min(...allX) - PAD,
    maxX: Math.max(...allX) + PAD,
    minY: Math.min(...allY) - PAD,
    maxY: Math.max(...allY) + PAD,
  };
}

/* ─── edge colour ─── */
function edgeStroke(state: SkillNodeData['state']) {
  switch (state) {
    case 'owned':       return GOLD;
    case 'in_progress': return PROG_RING;
    case 'available':   return AVAIL_RING;
    default:            return LOCKED_RING;
  }
}
function edgeOpacity(state: SkillNodeData['state']) {
  switch (state) {
    case 'owned':       return 0.85;
    case 'in_progress': return 0.6;
    case 'available':   return 0.38;
    default:            return 0.18;
  }
}

/* ─── node colours ─── */
function nodeColors(state: SkillNodeData['state']) {
  switch (state) {
    case 'owned':       return { fill: '#14120A', ring: GOLD,      glow: GOLD_GLOW,              icon: GOLD };
    case 'in_progress': return { fill: '#0E1425', ring: PROG_RING,  glow: 'rgba(74,106,184,0.4)', icon: PROG_COL };
    case 'available':   return { fill: '#0E1220', ring: AVAIL_RING, glow: 'rgba(52,64,112,0.3)',  icon: '#6080B8' };
    default:            return { fill: LOCKED_FILL, ring: LOCKED_RING, glow: 'none',              icon: '#3A405A' };
  }
}

/* ─── mini SVG icon paths (24-viewbox) ─── */
function KindIcon({ kind, size }: { kind: SkillNodeData['kind']; size: number }) {
  const s = size;
  switch (kind) {
    case 'root':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s}>
          <path d="M12 2l1.6 4.8L18.5 8l-4.9 1.6L12 14.5l-1.6-4.9L5.5 8l4.9-1.6z
                   M19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"
                fill="currentColor" />
        </svg>
      );
    case 'course':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s}>
          <path d="M22 10v6M2 10l10-5 10 5-10 5z M6 12v5c3 3 9 3 12 0v-5"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'lecture':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width={s} height={s}>
          <path d="M9 21h6 M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.1-3 5.2V17H9v-2.8C7.2 13.1 6 11.2 6 9a6 6 0 0 1 6-6z"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function getSemesterFromDescription(desc: string | undefined | null, title?: string): number | null {
  const text = `${desc || ''} ${title || ''}`;
  const match = text.match(/(\d+)\.\s*Semester/i) || text.match(/Semester\s*(\d+)/i) || text.match(/(\d+)(?:st|nd|rd|th)\s*Semester/i);
  return match ? parseInt(match[1], 10) : null;
}

/* ═══════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════ */
export function SkillTreeView({
  tree, counts, conceptsAvailable, hasContent,
  view, onViewChange, onOpenLecture, onBack,
}: Props) {
  const rootRef         = useRef<HTMLDivElement>(null);
  const scopeRef        = useRef<Scope | null>(null);
  const countRef        = useRef<HTMLSpanElement>(null);
  const particleGRef    = useRef<SVGGElement>(null);
  const animFrameRef    = useRef<number>(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId,  setHoveredId]  = useState<string | null>(null);
  const [selectedSemester, setSelectedSemester] = useState<string>('all');

  // Scan all courses in the original tree to find which semesters are present
  const semestersPresent = useMemo(() => {
    const sems = new Set<number>();
    (tree.children ?? []).forEach(course => {
      const sem = getSemesterFromDescription(course.desc, course.label);
      if (sem !== null) {
        sems.add(sem);
      }
    });
    return Array.from(sems).sort((a, b) => a - b);
  }, [tree.children]);

  // Filter the tree based on the selected semester
  const filteredTree = useMemo(() => {
    if (selectedSemester === 'all') return tree;
    const filteredCourses = (tree.children ?? []).filter(course => {
      const sem = getSemesterFromDescription(course.desc, course.label);
      return sem !== null && String(sem) === selectedSemester;
    });
    return {
      ...tree,
      children: filteredCourses,
    };
  }, [tree, selectedSemester]);

  const filteredCounts = useMemo(() => countSkills(filteredTree), [filteredTree]);

  /* ── layout ── */
  const { placed, edges, minX, maxX, minY, maxY } = useMemo(() => buildLayout(filteredTree), [filteredTree]);
  const vbW = maxX - minX;
  const vbH = maxY - minY;

  const selected = useMemo(
    () => placed.find(p => p.node.id === selectedId) ?? null,
    [placed, selectedId],
  );

  // Reset selected node if it's no longer visible in the tree
  useEffect(() => {
    if (selectedId && !placed.some(p => p.node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [placed, selectedId]);

  /* ── Bokeh particles (direct DOM mutation, no re-render) ── */
  useEffect(() => {
    if (!hasContent) return;
    const el = rootRef.current;
    if (!el) return;

    // Initialise particle data
    const N = 100;
    const pData = Array.from({ length: N }, () => ({
      x: Math.random() * 1400,
      y: Math.random() * 900,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
    }));

    const tick = () => {
      const g = particleGRef.current;
      if (g) {
        const circles = g.querySelectorAll('circle');
        circles.forEach((c, i) => {
          const p = pData[i];
          if (!p) return;
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = 1400;
          if (p.x > 1400) p.x = 0;
          if (p.y < 0) p.y = 900;
          if (p.y > 900) p.y = 0;
          c.setAttribute('cx', String(p.x));
          c.setAttribute('cy', String(p.y));
        });
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [hasContent]);

  /* ── anime.js entrance + glow ── */
  useEffect(() => {
    if (!hasContent) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (countRef.current) countRef.current.textContent = String(filteredCounts.owned);

    scopeRef.current = createScope({ root: rootRef }).add(() => {
      animate('[data-anim="ui"]', {
        opacity: [0, 1], translateY: [8, 0],
        duration: 480, delay: stagger(60), ease: 'outExpo',
      });
      if (reduced) return;

      const drawables = svg.createDrawable('.sk-edge');
      if (drawables.length) {
        animate(drawables, { draw: ['0 0', '0 1'], duration: 900, delay: stagger(14), ease: 'inOutSine' });
      }
      animate('.sk-node-circle', {
        opacity: [0, 1], scale: [0.35, 1],
        duration: 500, delay: stagger(22, { from: 'center' }), ease: 'outBack(1.4)',
      });
      animate('.sk-glow-ring', {
        opacity: [0.35, 0.8], scale: [0.85, 1.25],
        duration: 2400, loop: true, alternate: true, ease: 'inOutSine',
      });
      animate('.sk-label', {
        opacity: [0, 1], translateY: [5, 0],
        duration: 380, delay: stagger(18, { start: 280 }), ease: 'outExpo',
      });
      const counter = { n: 0 };
      animate(counter, {
        n: filteredCounts.owned, duration: 1300, ease: 'outExpo',
        modifier: utils.round(0),
        onUpdate: () => { if (countRef.current) countRef.current.textContent = String(Math.round(counter.n)); },
      });
    });
    return () => scopeRef.current?.revert();
  }, [placed.length, filteredCounts.owned, hasContent]);

  /* ── SVG filter IDs ── */
  const FID_GOLD   = 'sk-f-gold';
  const FID_BLUE   = 'sk-f-blue';
  const FID_LOCKED = 'sk-f-lock';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: `radial-gradient(ellipse at 48% 55%, #0C1022 0%, ${BG_DARK} 100%)` }}
      data-testid="skilltree-view"
    >
      {/* ── Bokeh layer (fixed, behind everything) ── */}
      <svg
        className="pointer-events-none absolute inset-0"
        width="100%" height="100%"
        aria-hidden="true"
        style={{ overflow: 'hidden' }}
      >
        <g ref={particleGRef}>
          {Array.from({ length: 100 }, (_, i) => (
            <circle
              key={i}
              cx={Math.random() * 1400}
              cy={Math.random() * 900}
              r={Math.random() * 1.8 + 0.3}
              fill={i % 6 === 0 ? GOLD : '#FFFFFF'}
              opacity={Math.random() * 0.35 + 0.06}
            />
          ))}
        </g>
      </svg>

      {/* ── Soft atmospheric glows ── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div style={{ position:'absolute', left:'18%', top:'20%', width:520, height:520, borderRadius:'50%', background:'rgba(212,168,67,0.035)', filter:'blur(110px)' }} />
        <div style={{ position:'absolute', right:'12%', bottom:'18%', width:420, height:420, borderRadius:'50%', background:'rgba(70,90,200,0.045)', filter:'blur(100px)' }} />
      </div>

      {/* ── Main skill-tree SVG ── */}
      {hasContent ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
          >
            <defs>
              {/* Gold glow */}
              <filter id={FID_GOLD} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="7" result="b" />
                <feFlood floodColor={GOLD} floodOpacity="0.65" result="c" />
                <feComposite in="c" in2="b" operator="in" result="g" />
                <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              {/* Blue glow */}
              <filter id={FID_BLUE} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="b" />
                <feFlood floodColor={PROG_RING} floodOpacity="0.55" result="c" />
                <feComposite in="c" in2="b" operator="in" result="g" />
                <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              {/* Subtle locked */}
              <filter id={FID_LOCKED} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2" />
              </filter>
            </defs>

            {/* ── Edges ── */}
            {edges.map(e => (
              <line
                key={e.id}
                className="sk-edge"
                x1={e.sx} y1={e.sy}
                x2={e.tx} y2={e.ty}
                stroke={edgeStroke(e.state)}
                strokeWidth={e.state === 'owned' ? 2.5 : 1.8}
                strokeOpacity={edgeOpacity(e.state)}
                strokeLinecap="round"
                filter={e.state === 'owned' ? `url(#${FID_GOLD})` : undefined}
              />
            ))}

            {/* ── Nodes ── */}
            {placed.map(({ node, x, y, r }) => {
              const colors   = nodeColors(node.state);
              const owned    = node.state === 'owned';
              const locked   = node.state === 'locked';
              const inProg   = node.state === 'in_progress';
              const sel      = selectedId === node.id;
              const hov      = hoveredId  === node.id;
              const nr       = hov && !sel ? r * 1.1 : r;
              const glowFlt  = owned ? `url(#${FID_GOLD})` : inProg ? `url(#${FID_BLUE})` : locked ? `url(#${FID_LOCKED})` : undefined;
              const iconSize = nr * 0.9;

              return (
                <g
                  key={node.id}
                  transform={`translate(${x},${y})`}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  aria-label={`${node.label} — ${node.state.replace('_',' ')}`}
                  tabIndex={0}
                  onClick={() => setSelectedId(p => p === node.id ? null : node.id)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setSelectedId(p => p===node.id?null:node.id); } }}
                >
                  {/* Outer glow ring */}
                  {!locked && (
                    <circle
                      className="sk-glow-ring"
                      r={nr + 12}
                      fill="none"
                      stroke={colors.ring}
                      strokeWidth={1}
                      strokeOpacity={owned ? 0.5 : 0.22}
                      filter={glowFlt}
                    />
                  )}

                  {/* Selection dashed ring */}
                  {sel && (
                    <circle
                      r={nr + 7}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                      strokeOpacity={0.55}
                      strokeDasharray="5 4"
                    />
                  )}

                  {/* Main body */}
                  <circle
                    className="sk-node-circle"
                    r={nr}
                    fill={colors.fill}
                    stroke={sel ? '#FFFFFF' : colors.ring}
                    strokeWidth={sel ? 2.5 : owned ? 2 : 1.5}
                    filter={glowFlt}
                  />

                  {/* Inner ring decoration */}
                  {r >= 20 && (
                    <circle
                      r={nr * 0.68}
                      fill="none"
                      stroke={colors.ring}
                      strokeWidth={0.8}
                      strokeOpacity={0.3}
                    />
                  )}

                  {/* Progress arc */}
                  {inProg && typeof node.progress === 'number' && (() => {
                    const circ = 2 * Math.PI * (nr + 5);
                    const dash = node.progress * circ;
                    return (
                      <circle
                        r={nr + 5}
                        fill="none"
                        stroke={PROG_COL}
                        strokeWidth={3}
                        strokeOpacity={0.8}
                        strokeDasharray={`${dash} ${circ - dash}`}
                        strokeLinecap="round"
                        transform="rotate(-90)"
                      />
                    );
                  })()}

                  {/* Icon */}
                  <foreignObject
                    x={-iconSize / 2}
                    y={-iconSize / 2}
                    width={iconSize}
                    height={iconSize}
                    style={{ color: colors.icon, opacity: locked ? 0.4 : 1, pointerEvents: 'none' }}
                  >
                    <div style={{ width: iconSize, height: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <KindIcon kind={node.kind} size={iconSize * 0.82} />
                    </div>
                  </foreignObject>

                  {/* Owned checkmark badge */}
                  {owned && (
                    <g transform={`translate(${nr * 0.65},${-nr * 0.65})`}>
                      <circle r={8} fill="#100E06" stroke={GOLD} strokeWidth={1.5} />
                      <polyline
                        points="-4,0 -1,3 5,-3"
                        fill="none"
                        stroke={GOLD}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  )}

                  {/* Lock badge */}
                  {locked && (
                    <g transform={`translate(${nr * 0.65},${-nr * 0.65})`}>
                      <circle r={8} fill={LOCKED_FILL} stroke={LOCKED_RING} strokeWidth={1} />
                      <rect x="-4" y="-1" width="8" height="6" rx="1" fill="none" stroke={LOCKED_RING} strokeWidth="1.5" />
                      <path d="M-2 -1 v-2 a2 2 0 0 1 4 0 v2" fill="none" stroke={LOCKED_RING} strokeWidth="1.5" strokeLinecap="round" />
                    </g>
                  )}

                  {/* Label */}
                  <text
                    className="sk-label"
                    y={nr + 18}
                    textAnchor="middle"
                    fill={locked ? '#363C55' : owned ? GOLD : '#9AAACE'}
                    fontSize={node.kind === 'root' ? 14 : node.kind === 'course' ? 12 : 10}
                    fontWeight={owned || node.kind === 'root' ? '700' : '500'}
                    fontFamily="Inter, system-ui, sans-serif"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
                  </text>

                  {/* Course label cap */}
                  {node.kind === 'course' && (
                    <text
                      y={-nr - 10}
                      textAnchor="middle"
                      fill="#3A4260"
                      fontSize={8}
                      fontWeight="800"
                      letterSpacing="2"
                      fontFamily="Inter, system-ui, sans-serif"
                      style={{ pointerEvents: 'none', userSelect: 'none', textTransform: 'uppercase' }}
                    >
                      COURSE
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        /* ── Empty state ── */
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div style={{ width:68, height:68, borderRadius:'50%', border:`2px solid ${LOCKED_RING}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <GitBranch style={{ width:28, height:28, color:'#3A4260' }} />
          </div>
          <p style={{ color:'#D0DCFF', fontWeight:700, fontSize:15, margin:0 }}>No skills to map yet</p>
          <p style={{ color:'#3A4260', fontSize:12, maxWidth:280, margin:0, lineHeight:1.6 }}>
            Complete a lecture in any course to start unlocking your skill constellation.
          </p>
        </div>
      )}

      {/* ══ Header ══ */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 p-4 md:p-5">
        <div data-anim="ui" style={{ display:'flex', alignItems:'center', gap:12, opacity:0 }}>
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            style={{
              display:'flex', width:40, height:40, alignItems:'center', justifyContent:'center',
              borderRadius:12, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)',
              color:'#505878', cursor:'pointer', transition:'color .2s, border-color .2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color='#D0DCFF'; e.currentTarget.style.borderColor='rgba(255,255,255,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.color='#505878'; e.currentTarget.style.borderColor='rgba(255,255,255,0.09)'; }}
          >
            <ChevronLeft style={{ width:20, height:20 }} aria-hidden="true" />
          </button>

          <div style={{
            background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)',
            borderRadius:14, padding:'7px 16px',
          }}>
            <p style={{ fontSize:9, fontWeight:900, letterSpacing:'0.3em', color:GOLD, textTransform:'uppercase', margin:'0 0 3px' }}>
              Skill Constellation
            </p>
            <p style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:700, color:'#D0DCFF', margin:0 }}>
              <Sparkles style={{ width:14, height:14, color:GOLD }} aria-hidden="true" />
              <span ref={countRef} style={{ color:GOLD }}>{filteredCounts.owned}</span>
              <span style={{ color:'#3A4260' }}>/ {filteredCounts.total} mastered</span>
            </p>
          </div>
        </div>

        {/* Dynamic Semester Selector */}
        {semestersPresent.length > 0 && (
          <div
            data-anim="ui"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(6,8,16,0.6)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: 4,
              backdropFilter: 'blur(12px)',
              opacity: 0,
            }}
          >
            <button
              onClick={() => setSelectedSemester('all')}
              style={{
                background: selectedSemester === 'all' ? GOLD : 'transparent',
                color: selectedSemester === 'all' ? '#060810' : '#8A99AD',
                border: 'none',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.1em',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'uppercase',
              }}
              onMouseEnter={e => {
                if (selectedSemester !== 'all') {
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }
              }}
              onMouseLeave={e => {
                if (selectedSemester !== 'all') {
                  e.currentTarget.style.color = '#8A99AD';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              All
            </button>
            {semestersPresent.map(sem => (
              <button
                key={sem}
                onClick={() => setSelectedSemester(String(sem))}
                style={{
                  background: selectedSemester === String(sem) ? GOLD : 'transparent',
                  color: selectedSemester === String(sem) ? '#060810' : '#8A99AD',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textTransform: 'uppercase',
                }}
                onMouseEnter={e => {
                  if (selectedSemester !== String(sem)) {
                    e.currentTarget.style.color = '#FFFFFF';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                  }
                }}
                onMouseLeave={e => {
                  if (selectedSemester !== String(sem)) {
                    e.currentTarget.style.color = '#8A99AD';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                Sem {sem}
              </button>
            ))}
          </div>
        )}

        <div data-anim="ui" style={{ opacity:0 }}>
          <InsightsViewTabs view={view} onChange={onViewChange} />
        </div>
      </div>

      {/* ══ Legend ══ */}
      <div data-anim="ui" className="absolute bottom-4 left-4 z-10" style={{ opacity:0 }}>
        <div style={{
          display:'flex', alignItems:'center', gap:18,
          background:'rgba(6,8,16,0.8)', border:'1px solid rgba(255,255,255,0.07)',
          borderRadius:12, padding:'8px 18px', backdropFilter:'blur(14px)',
        }}>
          {[
            { label:'Mastered',    color: GOLD      },
            { label:'In Progress', color: PROG_RING  },
            { label:'Available',   color: AVAIL_RING },
            { label:'Locked',      color: LOCKED_RING },
          ].map(({ label, color }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:color, boxShadow:`0 0 6px ${color}`, flexShrink:0 }} />
              <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', color:'#3A4260', textTransform:'uppercase' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ══ Info panel ══ */}
      {selected && (
        <SkillInfoPanel
          key={selected.node.id}
          node={selected.node}
          onClose={() => setSelectedId(null)}
          onOpenLecture={onOpenLecture}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Info Panel
   ═══════════════════════════════════════════════ */
function SkillInfoPanel({
  node, onClose, onOpenLecture,
}: {
  node: SkillNodeData;
  onClose: () => void;
  onOpenLecture: (id: string) => void;
}) {
  const owned   = node.state === 'owned';
  const locked  = node.state === 'locked';
  const inProg  = node.state === 'in_progress';
  const canOpen = node.kind === 'lecture' && !!node.lectureId && !locked;

  const kindLabel = { root:'Overview', course:'Course', lecture:'Lecture',
    'course-concept':'Concept', 'lecture-concept':'Concept' }[node.kind];

  let body = '';
  if (node.kind === 'root') {
    const n = node.children?.length ?? 0;
    body = n ? `${n} course${n===1?'':'s'} in your library.` : 'Complete a lecture to build your constellation.';
  } else if (node.kind === 'course') {
    const m = node.meta;
    body = m ? `${m.owned} of ${m.total} lectures mastered.` : 'A course in your library.';
  } else if (node.kind === 'lecture') {
    body = locked
      ? 'Locked — complete the previous lecture to unlock it.'
      : node.desc?.trim() || 'Finish this lecture\'s quiz to master it.';
  } else {
    body = node.mastery && node.mastery.attempts > 0
      ? `${Math.round(node.mastery.score * 100)}% mastery · ${node.mastery.attempts} attempt${node.mastery.attempts===1?'':'s'}.`
      : locked
        ? 'Locked — finish the parent lecture first.'
        : 'Not practised yet.';
  }

  const stateMeta: Record<SkillNodeData['state'], { label: string; color: string; bg: string }> = {
    owned:       { label:'✦ Mastered',     color: GOLD,      bg:'rgba(212,168,67,0.12)' },
    in_progress: { label:'◑ In Progress',  color: PROG_COL,  bg:'rgba(74,106,184,0.14)' },
    available:   { label:'◯ Available',    color:'#6080B8',  bg:'rgba(52,64,112,0.18)'  },
    locked:      { label:'⊘ Locked',       color:'#3A4260',  bg:'rgba(37,43,64,0.3)'    },
  };
  const sm = stateMeta[node.state];

  return (
    <aside
      data-testid="skill-info-panel"
      style={{
        position:'absolute', right:20, top:'50%', transform:'translateY(-50%)',
        width:272, zIndex:20,
        background:'rgba(6,8,18,0.94)',
        border:`1px solid ${owned ? 'rgba(212,168,67,0.3)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius:16, padding:20,
        backdropFilter:'blur(22px)',
        boxShadow: owned
          ? `0 0 50px rgba(212,168,67,0.1), 0 10px 40px rgba(0,0,0,0.6)`
          : `0 10px 40px rgba(0,0,0,0.6)`,
        animation:'sk-panel-in 0.22s ease-out both',
      }}
    >
      <style>{`
        @keyframes sk-panel-in {
          from { opacity:0; transform:translateY(-50%) translateX(10px); }
          to   { opacity:1; transform:translateY(-50%) translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:9, fontWeight:900, letterSpacing:'0.25em', color:'#3A4260', textTransform:'uppercase' }}>
          {kindLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ display:'flex', width:24, height:24, alignItems:'center', justifyContent:'center',
            borderRadius:6, background:'none', border:'none', color:'#3A4260', cursor:'pointer', transition:'color .2s' }}
          onMouseEnter={e => (e.currentTarget.style.color='#D0DCFF')}
          onMouseLeave={e => (e.currentTarget.style.color='#3A4260')}
        >
          <X style={{ width:14, height:14 }} />
        </button>
      </div>

      {/* Title */}
      <h3 style={{ fontSize:16, fontWeight:700, color: owned ? GOLD : '#D0DCFF', margin:'0 0 10px', lineHeight:1.3 }}>
        {node.label}
      </h3>

      {/* State badge */}
      <span style={{
        display:'inline-flex', alignItems:'center',
        background:sm.bg, color:sm.color,
        borderRadius:20, padding:'4px 11px',
        fontSize:10, fontWeight:700, letterSpacing:'0.07em',
        marginBottom:12,
      }}>
        {sm.label}
      </span>

      {/* Progress bar */}
      {inProg && typeof node.progress === 'number' && (
        <div style={{ marginBottom:12 }}>
          <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:4, overflow:'hidden' }}>
            <div style={{ height:'100%', borderRadius:4,
              width:`${Math.round((node.progress ?? 0)*100)}%`,
              background:`linear-gradient(90deg, ${AVAIL_RING}, ${PROG_COL})` }}
            />
          </div>
          <p style={{ fontSize:10, color:'#3A4260', margin:'4px 0 0', textAlign:'right' }}>
            {Math.round((node.progress??0)*100)}% complete
          </p>
        </div>
      )}

      {/* Mastery bar for concepts */}
      {(node.kind==='lecture-concept'||node.kind==='course-concept') && node.mastery && node.mastery.attempts > 0 && (
        <div style={{ marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span style={{ fontSize:9, color:'#3A4260', textTransform:'uppercase', letterSpacing:'0.1em' }}>Mastery</span>
            <span style={{ fontSize:9, color: owned ? GOLD : PROG_COL, fontWeight:700 }}>
              {Math.round(node.mastery.score*100)}%
            </span>
          </div>
          <div style={{ height:3, background:'rgba(255,255,255,0.05)', borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', borderRadius:3,
              width:`${Math.round(node.mastery.score*100)}%`,
              background: owned ? `linear-gradient(90deg,${GOLD_DIM},${GOLD})` : `linear-gradient(90deg,${AVAIL_RING},${PROG_COL})` }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      <p style={{ fontSize:12, color:'#505878', lineHeight:1.65, margin:'0 0 14px' }}>{body}</p>

      {/* Divider */}
      <div style={{ height:1, background: owned ? 'rgba(212,168,67,0.1)' : 'rgba(255,255,255,0.05)', marginBottom:14 }} />

      {/* CTA */}
      {canOpen ? (
        <button
          type="button"
          onClick={() => onOpenLecture(node.lectureId!)}
          style={{
            display:'flex', width:'100%', alignItems:'center', justifyContent:'center', gap:8,
            background:`linear-gradient(135deg, ${GOLD_DIM}, ${GOLD})`,
            border:'none', borderRadius:10, padding:'10px 0',
            color:'#0A0800', fontSize:11, fontWeight:800, cursor:'pointer',
            letterSpacing:'0.06em', textTransform:'uppercase',
            boxShadow:`0 0 24px rgba(212,168,67,0.22)`,
            transition:'opacity .2s, box-shadow .2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity='0.85'; e.currentTarget.style.boxShadow=`0 0 36px rgba(212,168,67,0.38)`; }}
          onMouseLeave={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.boxShadow=`0 0 24px rgba(212,168,67,0.22)`; }}
        >
          Open Lecture
          <ArrowRight style={{ width:14, height:14 }} />
        </button>
      ) : (
        <div style={{ fontSize:10, color:'#2A3050', textAlign:'center', letterSpacing:'0.05em' }}>
          {locked ? 'Complete earlier lectures to unlock' : node.kind === 'root' ? 'Click a course to explore' : 'Concept node'}
        </div>
      )}
    </aside>
  );
}
