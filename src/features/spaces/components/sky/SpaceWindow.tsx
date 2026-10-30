import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import type { Space } from '../../types';
import { MAP_PALETTE } from '../SpaceMap';

/**
 * A Space, seen through a round window onto its own first page.
 *
 * The night-sky pass drew each Space as a planet. Abi, 2026-10-26: "we dont
 * want a real planet shape — use something from the files so the experience is
 * unique… by default really calm and not overwhelming." So the picture is the
 * Space itself: page 1 of its first Lesson (the poster — a small WebP, never
 * the PDF), set in a circle.
 *
 * **Calm by default.** The page sits in black and white, dimmed, so a row of
 * them reads as one quiet family on the black stage and no slide's colours
 * shout. Selected, it lifts a little — never to full colour. `look` is the
 * seam for letting an owner choose later (another cover page, a tint); today
 * every window is `calm`.
 *
 * **Progress is the ring**, in the map's palette: a faint track, gold for the
 * part of the path you have finished, and one small white point where you are
 * now. No number is drawn; the accessible name carries the counts.
 *
 * Without a poster (a Space still being read, an old upload) the window shows
 * a faint page — a few lines of text, drawn — rather than a placeholder icon.
 *
 * SVG throughout, so the same window stands in a row of buttons and inside the
 * Ascent map's own SVG (`cx`/`cy`).
 */

/**
 * Each look has a dark-page and a light-page version.
 *
 * A dark page (a photo, a dark title slide) is simply quietened. A light page
 * — most slide decks: white ground, black text — would still be the brightest
 * thing on the black stage however far it is dimmed, so it is shown at night:
 * inverted, the ground dark and the writing pale. Same page, same words.
 */
export const WINDOW_LOOKS = {
  calm: {
    dark: { rest: 'grayscale(1) contrast(0.7) brightness(0.6)', lifted: 'grayscale(0.85) contrast(0.85) brightness(0.78)' },
    light: { rest: 'grayscale(1) invert(1) contrast(0.75) brightness(0.8)', lifted: 'grayscale(1) invert(1) contrast(0.85) brightness(0.95)' },
  },
} as const;
export type WindowLook = keyof typeof WINDOW_LOOKS;
export type PageTone = 'light' | 'dark';

/** Mean luminance above this reads as a light page. */
export const LIGHT_PAGE = 0.6;

/** Average luminance (0–1) of RGBA pixels, Rec. 709 weights. */
export const luminanceOf = (data: ArrayLike<number>): number => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    n++;
  }
  return n ? sum / n : 0;
};

/**
 * Light or dark, measured once per poster on a 24×24 copy and remembered for
 * the session. The poster is fetched anonymously so the canvas can be read;
 * if it cannot (no CORS, a tainted canvas, no canvas at all), the page is
 * treated as dark — the plain calm look, never a wrong inversion.
 */
const tones = new Map<string, PageTone>();

export function usePageTone(url: string | null | undefined): PageTone | null {
  const [tone, setTone] = useState<PageTone | null>(() => (url ? tones.get(url) ?? null : null));
  useEffect(() => {
    if (!url) return setTone(null);
    const known = tones.get(url);
    if (known) return setTone(known);
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let t: PageTone = 'dark';
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 24, 24);
          t = luminanceOf(ctx.getImageData(0, 0, 24, 24).data) > LIGHT_PAGE ? 'light' : 'dark';
        }
      } catch {
        // A tainted canvas: leave it dark.
      }
      tones.set(url, t);
      if (alive) setTone(t);
    };
    img.onerror = () => {
      tones.set(url, 'dark');
      if (alive) setTone('dark');
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return tone;
}

interface SpaceWindowProps {
  /** The Space's id — marks the window so a row and a map can find it. */
  spaceId?: string;
  /** Outer diameter in px, ring included. */
  size: number;
  /** The poster URL, or null/undefined for the drawn page. */
  cover?: string | null;
  /** 0–1: the fraction of the path finished. */
  progress: number;
  /** Mark where you are now with a white point on the ring. */
  current?: boolean;
  /** Lifts the page a little — for the selected Space. */
  lifted?: boolean;
  look?: WindowLook;
  /**
   * The accessible name. With it the window is `role="img"`; without it the
   * window is decoration and hidden, because the control around it is named.
   */
  label?: string;
  /** Centre, when drawn inside another SVG (Ascent). */
  cx?: number;
  cy?: number;
  className?: string;
}

/** What a Space's window shows, from the hub's own fields. */
export const windowOf = (space: Space) => ({
  spaceId: space.id,
  cover: space.cover ?? null,
  progress: Math.max(0, Math.min(1, space.viewerProgress / 100)),
  // "You are here" belongs to a Space you are in and have started.
  current: space.viewerRole !== null && space.viewerProgress > 0 && space.viewerProgress < 100,
});

export function SpaceWindow({
  spaceId,
  size,
  cover,
  progress,
  current,
  lifted,
  look = 'calm',
  label,
  cx,
  cy,
  className,
}: SpaceWindowProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const c = size / 2;
  const stroke = size >= 120 ? 2 : 1.5;
  const ringR = c - stroke;
  const gap = Math.max(3, size * 0.045);
  const inner = ringR - stroke / 2 - gap;
  const p = Math.max(0, Math.min(1, progress));
  const circ = 2 * Math.PI * ringR;
  // Where the gold ends — the white point sits there, from twelve o'clock.
  const a = -Math.PI / 2 + p * Math.PI * 2;
  const showPage = cover && !broken;
  const tone = usePageTone(cover);
  const filters = WINDOW_LOOKS[look][tone ?? 'dark'];

  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  const inSvg = cx !== undefined && cy !== undefined;

  return (
    <svg
      {...a11y}
      data-space-window={spaceId ?? ''}
      data-progress={p.toFixed(2)}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      x={inSvg ? cx - c : undefined}
      y={inSvg ? cy - c : undefined}
      overflow="visible"
      className={className}
    >
      <defs>
        <clipPath id={`win-${uid}`}>
          <circle cx={c} cy={c} r={inner} />
        </clipPath>
      </defs>

      <circle cx={c} cy={c} r={inner} fill="#ffffff" fillOpacity={0.035} />

      {showPage ? (
        /*
         * Two layers of the same page — calm, and lifted — crossfaded with
         * opacity. A filter is never animated (motion.test: only transform
         * and opacity move), so the lift is a fade between two still looks.
         */
        <g clipPath={`url(#win-${uid})`} data-tone={tone ?? undefined}>
          {/* The fade is on the group; the image stays plain so its filter follows the tone. */}
          <motion.g initial={false} animate={{ opacity: loaded && tone ? 1 : 0 }} transition={{ duration: 0.45 }}>
            <image
              data-cover
              href={cover}
              x={c - inner}
              y={c - inner}
              width={inner * 2}
              height={inner * 2}
              preserveAspectRatio="xMidYMid slice"
              style={{ filter: filters.rest }}
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          </motion.g>
          <motion.g
            aria-hidden
            initial={false}
            animate={{ opacity: loaded && tone && lifted ? 1 : 0 }}
            transition={{ duration: 0.45 }}
          >
            <image
              href={cover}
              x={c - inner}
              y={c - inner}
              width={inner * 2}
              height={inner * 2}
              preserveAspectRatio="xMidYMid slice"
              style={{ filter: filters.lifted }}
            />
          </motion.g>
        </g>
      ) : (
        <DrawnPage c={c} r={inner} />
      )}

      {/* The window's edge, so a dark page still reads as a round thing. */}
      <circle cx={c} cy={c} r={inner} fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />

      {/* The ring: a faint track, gold for what is done. */}
      <circle cx={c} cy={c} r={ringR} fill="none" stroke="#ffffff" strokeOpacity={0.12} strokeWidth={stroke} />
      {p > 0 && (
        <circle
          data-ring-done
          cx={c}
          cy={c}
          r={ringR}
          fill="none"
          stroke={MAP_PALETTE.goldCore}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${p * circ} ${circ}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      )}
      {current && (
        <circle
          data-ring-here
          cx={c + ringR * Math.cos(a)}
          cy={c + ringR * Math.sin(a)}
          r={Math.max(2.2, stroke * 1.6)}
          fill={MAP_PALETTE.hereRim}
        />
      )}
    </svg>
  );
}

/** A page with no poster yet: a title line and a few lines of text, faint. */
function DrawnPage({ c, r }: { c: number; r: number }) {
  const w = r * 1.1;
  const lines = [
    { y: -0.34, w: 0.62, o: 0.16, h: 0.075 },
    { y: -0.08, w: 1, o: 0.09, h: 0.05 },
    { y: 0.08, w: 0.9, o: 0.09, h: 0.05 },
    { y: 0.24, w: 0.96, o: 0.09, h: 0.05 },
    { y: 0.4, w: 0.55, o: 0.09, h: 0.05 },
  ];
  return (
    <g data-drawn-page>
      {lines.map((l, i) => (
        <rect
          key={i}
          x={c - w / 2}
          y={c + l.y * r}
          width={w * l.w}
          height={Math.max(1.5, l.h * r)}
          rx={Math.max(0.75, (l.h * r) / 2)}
          fill="#ffffff"
          fillOpacity={l.o}
        />
      ))}
    </g>
  );
}
