/**
 * What is behind the glass.
 *
 * The glass bends a picture of whatever lies under it, so that picture has to
 * be built: the stage's black, and every slide canvas that overlaps the glass
 * (plus a margin — refraction looks a little past the edge), drawn where it
 * sits on screen. The slides are pdf.js canvases already, which is the whole
 * reason real refraction is possible here and not on ordinary page content.
 *
 * Pure: rectangles in, drawImage arguments out.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Slot {
  /** Where the slide is on screen (CSS px, after its transform). */
  rect: Rect;
  /** The canvas's own pixel size. */
  srcWidth: number;
  srcHeight: number;
  opacity: number;
}

export interface DrawOp {
  /** Which slot this draws. */
  index: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** In the backdrop's CSS px, origin at the backdrop's top left. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  alpha: number;
}

/** The area sampled: the glass plus `margin` on every side. */
export function backdropRect(glass: Rect, margin: number): Rect {
  return {
    left: glass.left - margin,
    top: glass.top - margin,
    width: glass.width + margin * 2,
    height: glass.height + margin * 2,
  };
}

export function backdropOps(area: Rect, slots: Slot[]): DrawOp[] {
  const ops: DrawOp[] = [];
  slots.forEach((s, index) => {
    const { rect } = s;
    if (rect.width <= 0 || rect.height <= 0 || s.srcWidth <= 0 || s.srcHeight <= 0 || s.opacity <= 0) return;
    const left = Math.max(area.left, rect.left);
    const top = Math.max(area.top, rect.top);
    const right = Math.min(area.left + area.width, rect.left + rect.width);
    const bottom = Math.min(area.top + area.height, rect.top + rect.height);
    if (right <= left || bottom <= top) return;
    const kx = s.srcWidth / rect.width;
    const ky = s.srcHeight / rect.height;
    ops.push({
      index,
      sx: (left - rect.left) * kx,
      sy: (top - rect.top) * ky,
      sw: (right - left) * kx,
      sh: (bottom - top) * ky,
      dx: left - area.left,
      dy: top - area.top,
      dw: right - left,
      dh: bottom - top,
      alpha: Math.min(1, s.opacity),
    });
  });
  return ops;
}
