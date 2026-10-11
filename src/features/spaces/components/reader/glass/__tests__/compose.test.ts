import { describe, expect, it } from 'vitest';
import { backdropOps, backdropRect } from '../compose';

describe('what is behind the glass', () => {
  const glass = { left: 500, top: 700, width: 160, height: 40 };
  const area = backdropRect(glass, 20);

  it('samples the glass plus a margin on every side', () => {
    expect(area).toEqual({ left: 480, top: 680, width: 200, height: 80 });
  });

  it('draws only the part of a slide under the glass, at the canvas’s own scale', () => {
    // A 1000×560 slide on screen, rendered at 2x, whose bottom edge is at y=720.
    const slide = { rect: { left: 100, top: 160, width: 1000, height: 560 }, srcWidth: 2000, srcHeight: 1120, opacity: 1 };
    const [op] = backdropOps(area, [slide]);
    expect(op).toMatchObject({ index: 0, dx: 0, dy: 0, dw: 200, dh: 40, sx: 760, sy: 1040, sw: 400, sh: 80, alpha: 1 });
  });

  it('skips slides that are elsewhere, invisible or unpainted, and keeps the right slot index', () => {
    const away = { rect: { left: 0, top: 0, width: 100, height: 100 }, srcWidth: 200, srcHeight: 200, opacity: 1 };
    const hidden = { rect: { left: 400, top: 600, width: 400, height: 300 }, srcWidth: 800, srcHeight: 600, opacity: 0 };
    const blank = { rect: { left: 400, top: 600, width: 400, height: 300 }, srcWidth: 0, srcHeight: 0, opacity: 1 };
    const next = { rect: { left: 640, top: 600, width: 400, height: 300 }, srcWidth: 400, srcHeight: 300, opacity: 0.35 };
    const ops = backdropOps(area, [away, hidden, blank, next]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ index: 3, dx: 160, dw: 40, alpha: 0.35 });
  });
});
