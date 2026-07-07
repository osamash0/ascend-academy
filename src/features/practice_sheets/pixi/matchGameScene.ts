/**
 * matchGameScene — a drag-to-match mini-game built on PracticeSheetQuestion data.
 *
 * Left column: prompt cards (the question stems). Right column: shuffled answer
 * tokens (each question's correct_answer). Drag a token onto the prompt it
 * answers; a correct drop snaps + locks + glows green and scores a point, a
 * wrong drop springs the token back. Pure Pixi hit-testing, no DOM forms.
 */
import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  FederatedPointerEvent,
} from 'pixi.js';
import { observePixiPalette, readPixiPalette, type PixiPalette } from '@/lib/pixi';

export interface MatchPair {
  id: string;
  prompt: string;
  answer: string;
}

const CARD_W = 300;
const CARD_H = 60;
const GAP = 18;
const COL_GAP = 120;

interface PromptSlot {
  pair: MatchPair;
  container: Container;
  bg: Graphics;
  x: number;
  y: number;
  matched: boolean;
}

interface AnswerToken {
  pair: MatchPair;
  container: Container;
  bg: Graphics;
  home: { x: number; y: number };
  matched: boolean;
}

/** Deterministic shuffle (index-seeded) so we avoid Math.random and stay testable. */
function seededOrder<T>(items: T[]): T[] {
  const arr = items.map((item, i) => ({ item, k: ((i * 2654435761) >>> 0) % 100003 }));
  arr.sort((a, b) => a.k - b.k);
  return arr.map((x) => x.item);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export interface MatchGameOptions {
  onScore?: (correct: number, total: number) => void;
}

export class MatchGameScene {
  private readonly app: Application;
  private readonly root = new Container();
  private palette: PixiPalette;
  private prompts: PromptSlot[] = [];
  private tokens: AnswerToken[] = [];
  private dragTarget: AnswerToken | null = null;
  private dragOffset = { x: 0, y: 0 };
  private correct = 0;
  private total = 0;

  private readonly disposeTheme: () => void;
  private readonly onResize: () => void;

  constructor(app: Application, private readonly opts: MatchGameOptions = {}) {
    this.app = app;
    this.palette = readPixiPalette();
    app.stage.addChild(this.root);

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointermove', this.onDragMove);
    app.stage.on('pointerup', this.onDragEnd);
    app.stage.on('pointerupoutside', this.onDragEnd);

    this.disposeTheme = observePixiPalette((p) => {
      this.palette = p;
      this.repaint();
    });

    this.onResize = () => this.layout();
    app.renderer.on('resize', this.onResize);
  }

  setData(pairs: MatchPair[]) {
    this.root.removeChildren();
    this.prompts = [];
    this.tokens = [];
    this.correct = 0;
    this.total = pairs.length;

    for (const pair of pairs) {
      const slot = this.makeCard(truncate(pair.prompt, 60), false);
      this.prompts.push({ pair, container: slot.container, bg: slot.bg, x: 0, y: 0, matched: false });
      this.root.addChild(slot.container);
    }

    for (const pair of seededOrder(pairs)) {
      const token = this.makeCard(truncate(pair.answer, 36), true);
      const at: AnswerToken = {
        pair,
        container: token.container,
        bg: token.bg,
        home: { x: 0, y: 0 },
        matched: false,
      };
      token.container.eventMode = 'static';
      token.container.cursor = 'grab';
      token.container.on('pointerdown', (e: FederatedPointerEvent) => this.onDragStart(at, e));
      this.tokens.push(at);
      this.root.addChild(token.container);
    }

    this.layout();
    this.opts.onScore?.(this.correct, this.total);
  }

  private makeCard(label: string, isToken: boolean) {
    const container = new Container();
    const bg = new Graphics();
    container.addChild(bg);
    const text = new Text({
      text: label,
      style: new TextStyle({
        fill: this.palette.foreground,
        fontSize: 13,
        fontWeight: isToken ? '700' : '500',
        wordWrap: true,
        wordWrapWidth: CARD_W - 28,
      }),
    });
    text.anchor.set(0, 0.5);
    text.position.set(14, CARD_H / 2);
    container.addChild(text);
    this.paintCard(bg, isToken ? 'token' : 'idle');
    return { container, bg };
  }

  private paintCard(bg: Graphics, kind: 'idle' | 'token' | 'correct') {
    bg.clear();
    const fill =
      kind === 'correct' ? this.palette.success : kind === 'token' ? this.palette.primary : this.palette.muted;
    const alpha = kind === 'idle' ? 0.18 : 0.9;
    bg.roundRect(0, 0, CARD_W, CARD_H, 14).fill({ color: fill, alpha });
    bg.roundRect(0, 0, CARD_W, CARD_H, 14).stroke({
      width: 1.5,
      color: kind === 'idle' ? this.palette.border : fill,
      alpha: 0.9,
    });
  }

  private layout() {
    const totalH = this.prompts.length * (CARD_H + GAP) - GAP;
    const startY = Math.max(20, (this.app.screen.height - totalH) / 2);
    const midX = this.app.screen.width / 2;
    const leftX = midX - CARD_W - COL_GAP / 2;
    const rightX = midX + COL_GAP / 2;

    this.prompts.forEach((p, i) => {
      p.x = leftX;
      p.y = startY + i * (CARD_H + GAP);
      p.container.position.set(p.x, p.y);
    });

    this.tokens.forEach((t, i) => {
      if (t.matched) return;
      t.home = { x: rightX, y: startY + i * (CARD_H + GAP) };
      t.container.position.set(t.home.x, t.home.y);
    });
  }

  private repaint() {
    this.prompts.forEach((p) => this.paintCard(p.bg, p.matched ? 'correct' : 'idle'));
    this.tokens.forEach((t) => this.paintCard(t.bg, t.matched ? 'correct' : 'token'));
  }

  private onDragStart = (token: AnswerToken, e: FederatedPointerEvent) => {
    if (token.matched) return;
    this.dragTarget = token;
    token.container.cursor = 'grabbing';
    this.root.addChild(token.container); // bring to front
    const pos = token.container.position;
    this.dragOffset = { x: e.global.x - pos.x, y: e.global.y - pos.y };
  };

  private onDragMove = (e: FederatedPointerEvent) => {
    if (!this.dragTarget) return;
    this.dragTarget.container.position.set(e.global.x - this.dragOffset.x, e.global.y - this.dragOffset.y);
  };

  private onDragEnd = () => {
    const token = this.dragTarget;
    if (!token) return;
    this.dragTarget = null;
    token.container.cursor = 'grab';

    const hit = this.prompts.find((p) => !p.matched && this.overlaps(token, p));
    if (hit && hit.pair.id === token.pair.id) {
      // Correct match: lock both, snap token next to its prompt.
      token.matched = true;
      hit.matched = true;
      this.paintCard(token.bg, 'correct');
      this.paintCard(hit.bg, 'correct');
      token.container.position.set(hit.x + CARD_W + 12, hit.y);
      token.container.eventMode = 'none';
      this.correct += 1;
      this.opts.onScore?.(this.correct, this.total);
    } else {
      // Wrong / missed: spring home.
      token.container.position.set(token.home.x, token.home.y);
    }
  };

  private overlaps(token: AnswerToken, slot: PromptSlot): boolean {
    const t = token.container.position;
    const cx = t.x + CARD_W / 2;
    const cy = t.y + CARD_H / 2;
    return cx > slot.x && cx < slot.x + CARD_W && cy > slot.y && cy < slot.y + CARD_H;
  }

  destroy() {
    this.app.renderer.off('resize', this.onResize);
    this.app.stage.off('pointermove', this.onDragMove);
    this.app.stage.off('pointerup', this.onDragEnd);
    this.app.stage.off('pointerupoutside', this.onDragEnd);
    this.disposeTheme();
    this.root.destroy({ children: true });
  }
}
