/**
 * journeyMapScene — an animated path of stops for onboarding.
 *
 * A gentle winding path runs left→right with one stop per setup step. Completed
 * stops are filled + connected by a lit trail, the current stop pulses, future
 * stops are dim. A traveller marker eases along the trail to the active step,
 * setting a playful, gamified tone from the very first screen.
 */
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { observePixiPalette, readPixiPalette, mixColor, type PixiPalette } from '@/lib/pixi';

interface Stop {
  x: number;
  y: number;
  label: string;
}

export interface JourneyMapOptions {
  labels?: string[];
  reduceMotion?: boolean;
}

export class JourneyMapScene {
  private readonly app: Application;
  private readonly root = new Container();
  private readonly trailBase = new Graphics();
  private readonly trailLit = new Graphics();
  private readonly stopLayer = new Container();
  private readonly traveller = new Graphics();
  private palette: PixiPalette;

  private total = 5;
  private current = 1;
  private labels: string[] = [];
  private stops: Stop[] = [];
  private reduceMotion = false;

  private markerT = 0; // 0..(total-1) eased traveller position along stops
  private targetT = 0;
  private elapsed = 0;

  private readonly disposeTheme: () => void;
  private readonly onTick: () => void;
  private readonly onResize: () => void;

  constructor(app: Application, opts: JourneyMapOptions = {}) {
    this.app = app;
    this.palette = readPixiPalette();
    this.labels = opts.labels ?? [];
    this.reduceMotion = opts.reduceMotion ?? false;

    this.root.addChild(this.trailBase, this.trailLit, this.stopLayer, this.traveller);
    app.stage.addChild(this.root);

    this.disposeTheme = observePixiPalette((p) => {
      this.palette = p;
      this.draw();
    });
    this.onResize = () => this.rebuild();
    app.renderer.on('resize', this.onResize);

    this.onTick = () => {
      this.elapsed += this.app.ticker.deltaMS / 1000;
      // Ease the traveller toward its target stop. Reduced motion snaps instantly.
      const lerp = this.reduceMotion ? 1 : Math.min(1, this.app.ticker.deltaMS / 250);
      this.markerT += (this.targetT - this.markerT) * lerp;
      this.drawDynamic();
    };
    app.ticker.add(this.onTick);
  }

  setProgress(current: number, total: number) {
    this.total = Math.max(1, total);
    this.current = Math.max(1, Math.min(total, current));
    this.targetT = this.current - 1;
    this.rebuild();
  }

  private rebuild() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const padX = Math.min(80, w * 0.1);
    const usableW = Math.max(1, w - padX * 2);
    const midY = h / 2;
    const amp = Math.min(h * 0.22, 60);

    this.stops = [];
    for (let i = 0; i < this.total; i++) {
      const t = this.total === 1 ? 0.5 : i / (this.total - 1);
      const x = padX + t * usableW;
      const y = midY + Math.sin(t * Math.PI * 2) * amp;
      this.stops.push({ x, y, label: this.labels[i] ?? `Step ${i + 1}` });
    }
    this.draw();
  }

  private pointAt(t: number): { x: number; y: number } {
    if (this.stops.length === 0) return { x: 0, y: 0 };
    const i = Math.floor(t);
    const f = t - i;
    const a = this.stops[Math.max(0, Math.min(this.stops.length - 1, i))];
    const b = this.stops[Math.max(0, Math.min(this.stops.length - 1, i + 1))];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  private draw() {
    // Base (full) trail.
    this.trailBase.clear();
    this.stops.forEach((s, i) => {
      if (i === 0) this.trailBase.moveTo(s.x, s.y);
      else this.trailBase.lineTo(s.x, s.y);
    });
    this.trailBase.stroke({ width: 4, color: this.palette.border, alpha: 0.6 });

    // Stops.
    this.stopLayer.removeChildren();
    this.stops.forEach((s, i) => {
      const stepNum = i + 1;
      const done = stepNum < this.current;
      const active = stepNum === this.current;
      const color = done ? this.palette.success : active ? this.palette.primary : this.palette.muted;

      const g = new Graphics();
      g.circle(s.x, s.y, 16).fill({ color, alpha: done || active ? 1 : 0.3 });
      g.circle(s.x, s.y, 16).stroke({
        width: 2,
        color: done || active ? mixColor(color, 0xffffff, 0.3) : this.palette.border,
        alpha: 0.9,
      });
      this.stopLayer.addChild(g);

      const label = new Text({
        text: s.label,
        style: new TextStyle({
          fill: active ? this.palette.foreground : this.palette['muted-foreground'],
          fontSize: 11,
          fontWeight: active ? '700' : '500',
          align: 'center',
        }),
      });
      label.anchor.set(0.5, 0);
      label.position.set(s.x, s.y + 24);
      this.stopLayer.addChild(label);
    });
  }

  /** Per-frame: the lit trail up to the traveller + the pulsing marker. */
  private drawDynamic() {
    this.trailLit.clear();
    if (this.stops.length === 0) return;

    const end = this.pointAt(this.markerT);
    this.trailLit.moveTo(this.stops[0].x, this.stops[0].y);
    const whole = Math.floor(this.markerT);
    for (let i = 1; i <= whole; i++) this.trailLit.lineTo(this.stops[i].x, this.stops[i].y);
    this.trailLit.lineTo(end.x, end.y);
    this.trailLit.stroke({ width: 5, color: this.palette.success, alpha: 0.9, cap: 'round' });

    // The idle pulse is an infinite loop — collapse it to static under reduced motion (skill §6.B).
    const pulse = this.reduceMotion ? 0 : 0.5 + 0.5 * Math.sin(this.elapsed * 4);
    this.traveller.clear();
    this.traveller.circle(end.x, end.y, 10 + pulse * 4).fill({ color: this.palette.primary, alpha: 0.25 });
    this.traveller.circle(end.x, end.y, 9).fill({ color: this.palette.primary, alpha: 1 });
    this.traveller.circle(end.x, end.y, 9).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
  }

  destroy() {
    this.app.ticker.remove(this.onTick);
    this.app.renderer.off('resize', this.onResize);
    this.disposeTheme();
    this.root.destroy({ children: true });
  }
}
