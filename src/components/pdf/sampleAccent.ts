/**
 * The colour a page is lit with.
 *
 * A reading surface built next to a PDF wants one accent, and the honest
 * place to take it from is the page itself — the blue of a title, the red of
 * a warning box — rather than a theme constant the file never saw. This
 * reads a rendered page and returns its most saturated colour that is not
 * white, black or grey, as an `hsl()` string, or `null` when the page has
 * none worth naming (a page of black text on white has no accent, and
 * inventing one would be worse than leaving the theme's).
 *
 * Sampled on a stride rather than pixel by pixel: a 1200px-wide render is
 * ~500k pixels and every 7th one is plenty to find a title's colour.
 *
 * Pure, and browser-only. No canvas is drawn on; the caller's page is read
 * and left alone.
 */
export function sampleAccent(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    // A tainted canvas (cross-origin file) refuses to be read. No accent, then.
    return null;
  }

  /*
   * Bucket hues into 24 bins and weight each vote by saturation × lightness
   * distance from the extremes, so a few pixels of a strong blue title outvote
   * a wash of pale grey.
   */
  const bins = new Float64Array(24);
  const sums = new Float64Array(24 * 3); // h, s, l accumulators per bin
  const stride = 7 * 4;
  for (let i = 0; i < data.length; i += stride) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.18 || l < 0.12 || l > 0.9) continue; // grey, black, white
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = Math.floor(h / 15) % 24;
    const weight = s * (1 - Math.abs(l - 0.5));
    bins[bin] += weight;
    sums[bin * 3] += h * weight;
    sums[bin * 3 + 1] += s * weight;
    sums[bin * 3 + 2] += l * weight;
  }

  let best = -1;
  for (let i = 0; i < 24; i++) if (best === -1 || bins[i] > bins[best]) best = i;
  if (best === -1 || bins[best] === 0) return null;

  const w = bins[best];
  const h = Math.round(sums[best * 3] / w);
  const s = Math.round((sums[best * 3 + 1] / w) * 100);
  /*
   * Lightness is lifted into a band that reads on a near-black ground. The
   * page's own blue may be a printed #1a1aff; on #070b14 the same hue wants to
   * sit around 65% to be legible as a hairline or a word.
   */
  const l = Math.round(Math.min(72, Math.max(58, (sums[best * 3 + 2] / w) * 100 + 20)));
  return `hsl(${h} ${Math.min(90, Math.max(45, s))}% ${l}%)`;
}
