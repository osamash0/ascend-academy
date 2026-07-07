/**
 * skillTreeScene — a Pixi tech-tree renderer for the existing SkillNode model.
 *
 * This is a renderer swap, not a data change: it consumes the same tree that
 * `useSkillTree` / `buildSkillTree` already produce. State drives the visuals —
 * owned nodes glow, in_progress nodes show a fill ring, available nodes pulse a
 * thin ring, locked nodes are dim. Edges light up once their target is reached.
 *
 * Interaction: drag to pan, wheel to zoom, click a lecture node to open it.
 */
import { Application, Container, Graphics, Text, TextStyle, FederatedPointerEvent } from 'pixi.js';
import type { SkillNode, SkillNodeKind, SkillNodeState } from '../skillTree';
import { observePixiPalette, readPixiPalette, mixColor, type PixiPalette } from '@/lib/pixi';

const RADII: Record<SkillNodeKind, number> = {
  root: 40,
  course: 30,
  lecture: 20,
  'course-concept': 14,
  'lecture-concept': 12,
};

const COURSE_DIST = 220;
const GRID_ROW_H = 150;
const GRID_COL_W = 150;
const GRID_COLS = 3;
const CONCEPT_D = 92;

interface Placed {
  node: SkillNode;
  x: number;
  y: number;
  r: number;
}
interface Edge {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  state: SkillNodeState;
}

interface NodeView {
  placed: Placed;
  gfx: Graphics;
  glow: Graphics;
}

/** Mirrors SkillTreeView's fan-out + 3-column grid layout, kept self-contained. */
function buildLayout(tree: SkillNode): { placed: Placed[]; edges: Edge[] } {
  const placed: Placed[] = [{ node: tree, x: 0, y: 0, r: RADII.root }];
  const edges: Edge[] = [];

  const courses = tree.children ?? [];
  const numC = courses.length;

  courses.forEach((course, ci) => {
    const span = numC <= 1 ? 0 : Math.min(Math.PI * 1.35, (numC - 1) * (Math.PI / 2.5));
    const base = -Math.PI / 2;
    const angle = numC <= 1 ? base : base - span / 2 + (ci / (numC - 1)) * span;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const cosP = Math.cos(angle + Math.PI / 2);
    const sinP = Math.sin(angle + Math.PI / 2);

    const cx = cosA * COURSE_DIST;
    const cy = sinA * COURSE_DIST;
    placed.push({ node: course, x: cx, y: cy, r: RADII.course });
    edges.push({ sx: 0, sy: 0, tx: cx, ty: cy, state: course.state });

    const lectures = (course.children ?? []).filter((n) => n.kind === 'lecture');
    let prevX = cx;
    let prevY = cy;

    lectures.forEach((lec, li) => {
      const col = li % GRID_COLS;
      const row = Math.floor(li / GRID_COLS) + 1;
      const colOff = (col - (GRID_COLS - 1) / 2) * GRID_COL_W;
      const distOut = COURSE_DIST + row * GRID_ROW_H;
      const lx = cosA * distOut + cosP * colOff;
      const ly = sinA * distOut + sinP * colOff;

      placed.push({ node: lec, x: lx, y: ly, r: RADII.lecture });
      edges.push({ sx: prevX, sy: prevY, tx: lx, ty: ly, state: lec.state });
      prevX = lx;
      prevY = ly;

      (lec.children ?? []).slice(0, 4).forEach((c, ki) => {
        const sign = ki % 2 === 0 ? 1 : -1;
        const cAngle = angle + sign * (Math.PI / 4) * (1 + Math.floor(ki / 2) * 0.2);
        const ctx = lx + Math.cos(cAngle) * CONCEPT_D;
        const cty = ly + Math.sin(cAngle) * CONCEPT_D;
        placed.push({ node: c, x: ctx, y: cty, r: RADII['lecture-concept'] });
        edges.push({ sx: lx, sy: ly, tx: ctx, ty: cty, state: c.state });
      });
    });
  });

  return { placed, edges };
}

export interface SkillTreeSceneOptions {
  onOpenLecture?: (lectureId: string) => void;
}

export class SkillTreeScene {
  private readonly app: Application;
  private readonly world = new Container();
  private readonly edgeLayer = new Graphics();
  private readonly nodeLayer = new Container();
  private nodes: NodeView[] = [];
  private palette: PixiPalette;
  private elapsed = 0;
  private layout: { placed: Placed[]; edges: Edge[] } = { placed: [], edges: [] };

  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  private readonly disposeTheme: () => void;
  private readonly onTick: () => void;
  private readonly onWheel: (e: WheelEvent) => void;

  constructor(app: Application, private readonly opts: SkillTreeSceneOptions = {}) {
    this.app = app;
    this.palette = readPixiPalette();

    this.world.addChild(this.edgeLayer);
    this.world.addChild(this.nodeLayer);
    app.stage.addChild(this.world);

    // Pan via stage drag.
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', this.onPointerDown);
    app.stage.on('pointerup', this.onPointerUp);
    app.stage.on('pointerupoutside', this.onPointerUp);
    app.stage.on('pointermove', this.onPointerMove);

    this.onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.max(0.25, Math.min(2.5, this.world.scale.x * factor));
      this.world.scale.set(next);
    };
    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.disposeTheme = observePixiPalette((p) => {
      this.palette = p;
      this.redraw();
    });

    this.onTick = () => {
      this.elapsed += this.app.ticker.deltaMS / 1000;
      this.animate();
    };
    app.ticker.add(this.onTick);
  }

  setData(tree: SkillNode) {
    this.layout = buildLayout(tree);
    this.build();
    this.fitToScreen();
  }

  private build() {
    this.nodeLayer.removeChildren();
    this.nodes = [];

    for (const placed of this.layout.placed) {
      const glow = new Graphics();
      const gfx = new Graphics();
      const view: NodeView = { placed, gfx, glow };
      this.nodeLayer.addChild(glow);
      this.nodeLayer.addChild(gfx);

      if (placed.node.kind === 'root' || placed.node.kind === 'course') {
        const label = new Text({
          text: placed.node.label,
          style: new TextStyle({
            fill: this.palette.foreground,
            fontSize: placed.node.kind === 'root' ? 13 : 11,
            fontWeight: '700',
            align: 'center',
          }),
        });
        label.anchor.set(0.5);
        label.position.set(placed.x, placed.y + placed.r + 14);
        this.nodeLayer.addChild(label);
      }

      if (placed.node.lectureId && this.opts.onOpenLecture) {
        gfx.eventMode = 'static';
        gfx.cursor = 'pointer';
        const lectureId = placed.node.lectureId;
        gfx.on('pointertap', () => this.opts.onOpenLecture?.(lectureId));
      }

      this.nodes.push(view);
    }

    this.redraw();
  }

  private stateColor(state: SkillNodeState): number {
    switch (state) {
      case 'owned':
        return this.palette.xp;
      case 'in_progress':
        return this.palette.primary;
      case 'available':
        return this.palette.accent;
      default:
        return this.palette.muted;
    }
  }

  /** Full repaint (theme change / rebuild). Per-frame work happens in animate(). */
  private redraw() {
    const dim = mixColor(this.palette.muted, this.palette.background, 0.4);

    this.edgeLayer.clear();
    for (const e of this.layout.edges) {
      const lit = e.state === 'owned' || e.state === 'in_progress';
      this.edgeLayer
        .moveTo(e.sx, e.sy)
        .lineTo(e.tx, e.ty)
        .stroke({ width: lit ? 2.5 : 1.5, color: lit ? this.stateColor(e.state) : dim, alpha: lit ? 0.9 : 0.5 });
    }

    for (const { placed, gfx } of this.nodes) {
      this.drawNode(gfx, placed);
    }
  }

  private drawNode(gfx: Graphics, placed: Placed) {
    const { node, r } = placed;
    const color = this.stateColor(node.state);
    const locked = node.state === 'locked';
    gfx.clear();
    gfx.position.set(placed.x, placed.y);

    // Body
    gfx.circle(0, 0, r).fill({ color: locked ? this.palette.muted : color, alpha: locked ? 0.25 : 1 });

    // Outer ring
    gfx
      .circle(0, 0, r)
      .stroke({ width: 2, color: locked ? this.palette.border : mixColor(color, 0xffffff, 0.3), alpha: 0.9 });

    // in_progress fill arc (0..1)
    if (node.state === 'in_progress' && node.progress != null) {
      const a0 = -Math.PI / 2;
      const a1 = a0 + Math.PI * 2 * Math.max(0, Math.min(1, node.progress));
      gfx
        .arc(0, 0, r + 5, a0, a1)
        .stroke({ width: 4, color: this.palette.xp, alpha: 0.95, cap: 'round' });
    }
  }

  private animate() {
    for (const { placed, glow } of this.nodes) {
      glow.clear();
      glow.position.set(placed.x, placed.y);
      const color = this.stateColor(placed.node.state);

      if (placed.node.state === 'owned') {
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 2 + placed.x * 0.01);
        glow.circle(0, 0, placed.r + 8 + pulse * 6).fill({ color, alpha: 0.12 + pulse * 0.12 });
      } else if (placed.node.state === 'available') {
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 3 + placed.y * 0.01);
        glow.circle(0, 0, placed.r + 4 + pulse * 5).stroke({ width: 2, color, alpha: 0.2 + pulse * 0.4 });
      }
    }
  }

  private fitToScreen() {
    if (this.layout.placed.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.layout.placed) {
      minX = Math.min(minX, p.x - p.r);
      minY = Math.min(minY, p.y - p.r);
      maxX = Math.max(maxX, p.x + p.r);
      maxY = Math.max(maxY, p.y + p.r);
    }
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const pad = 80;
    const sx = (this.app.screen.width - pad) / w;
    const sy = (this.app.screen.height - pad) / h;
    const scale = Math.max(0.25, Math.min(1.5, Math.min(sx, sy)));
    this.world.scale.set(scale);
    this.world.position.set(
      this.app.screen.width / 2 - ((minX + maxX) / 2) * scale,
      this.app.screen.height / 2 - ((minY + maxY) / 2) * scale,
    );
  }

  private onPointerDown = (e: FederatedPointerEvent) => {
    this.dragging = true;
    this.lastPointer = { x: e.global.x, y: e.global.y };
  };
  private onPointerUp = () => {
    this.dragging = false;
  };
  private onPointerMove = (e: FederatedPointerEvent) => {
    if (!this.dragging) return;
    this.world.position.x += e.global.x - this.lastPointer.x;
    this.world.position.y += e.global.y - this.lastPointer.y;
    this.lastPointer = { x: e.global.x, y: e.global.y };
  };

  destroy() {
    this.app.ticker.remove(this.onTick);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.stage.off('pointerdown', this.onPointerDown);
    this.app.stage.off('pointerup', this.onPointerUp);
    this.app.stage.off('pointerupoutside', this.onPointerUp);
    this.app.stage.off('pointermove', this.onPointerMove);
    this.disposeTheme();
    this.world.destroy({ children: true });
  }
}
