/**
 * Bridges the app's HSL CSS-variable theme into Pixi-usable color numbers.
 *
 * The design system stores colors as raw HSL channels (e.g. `--primary: 235 85% 65%`)
 * so Tailwind can wrap them in `hsl(...)`. Pixi wants numeric/hex colors, and it
 * reads the *computed* value — which means scenes automatically pick up the active
 * light/dark theme. `observePixiPalette` lets a scene live-update on theme switch.
 */

const VARS = [
  'background',
  'foreground',
  'primary',
  'primary-dim',
  'accent',
  'success',
  'warning',
  'xp',
  'muted',
  'muted-foreground',
  'border',
] as const;

export type PixiVar = (typeof VARS)[number];
export type PixiPalette = Record<PixiVar, number>;

/** "235 85% 65%" or "235 85% 65% / 0.12" → 0xRRGGBB (alpha channel ignored). */
function hslVarToNumber(value: string): number {
  const core = value.split('/')[0].trim();
  const parts = core.split(/\s+/);
  if (parts.length < 3) return 0x888888;
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return 0x888888;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = l - c / 2;
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}

/** Snapshot the current theme as Pixi color numbers. */
export function readPixiPalette(el: HTMLElement = document.documentElement): PixiPalette {
  const cs = getComputedStyle(el);
  const out = {} as PixiPalette;
  for (const name of VARS) {
    const raw = cs.getPropertyValue(`--${name}`).trim();
    out[name] = raw ? hslVarToNumber(raw) : 0x888888;
  }
  return out;
}

/**
 * Calls `cb` with a fresh palette whenever the theme toggles (next-themes flips a
 * class / data-theme on <html>). Returns a disposer.
 */
export function observePixiPalette(cb: (palette: PixiPalette) => void): () => void {
  const obs = new MutationObserver(() => cb(readPixiPalette()));
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
  return () => obs.disconnect();
}

/** Linearly blend two 0xRRGGBB colors. t=0 → a, t=1 → b. */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
