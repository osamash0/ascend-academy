/**
 * Shared constants for the console design layer.
 *
 * Extracted verbatim from the original StudentCourseLibrary so the look is
 * identical wherever these primitives are used.
 */

export type ConsoleStatus = 'done' | 'progress' | 'new';

/** Default carousel tile geometry (portrait "cover art"). */
export const CARD_W = 240;
export const CARD_H = 320;
/** Distance between adjacent card centers. */
export const STEP = 268;

/** Cover-art gradients, cycled per item so each tile feels distinct. */
export const COVER_GRADIENTS = [
  'from-slate-300/30 via-slate-500/20 to-slate-900',
  'from-cyan-500/40 via-blue-600/30 to-slate-900',
  'from-rose-500/40 via-pink-600/30 to-slate-900',
  'from-amber-500/40 via-orange-600/30 to-slate-900',
  'from-emerald-500/40 via-teal-600/30 to-slate-900',
  'from-lime-400/35 via-green-600/25 to-slate-900',
];

/** Ambient page-glow color keyed to a status. */
export const GLOW_BY_STATUS: Record<ConsoleStatus, string> = {
  done: 'rgba(34,197,94,0.18)',
  progress: 'rgba(255,255,255,0.10)',
  new: 'rgba(148,163,184,0.16)',
};

/**
 * Ambient page-glow color keyed to the focused item, aligned 1:1 with
 * COVER_GRADIENTS so the background light responds to the same color the
 * focused card shows (silver → cyan → rose → amber → emerald → lime). No
 * purple: the brand is monochrome (2026-10-10).
 */
export const ACCENT_GLOWS = [
  'rgba(203,213,225,0.22)', // silver
  'rgba(6,182,212,0.28)', // cyan
  'rgba(244,63,94,0.28)', // rose
  'rgba(245,158,11,0.28)', // amber
  'rgba(16,185,129,0.28)', // emerald
  'rgba(132,204,22,0.26)', // lime
];

const wrap = (index: number, len: number) => ((index % len) + len) % len;

export const gradientFor = (index: number) =>
  COVER_GRADIENTS[wrap(index, COVER_GRADIENTS.length)];

/** Ambient glow color for the focused gradient index (matches gradientFor). */
export const accentGlowFor = (index: number) =>
  ACCENT_GLOWS[wrap(index, ACCENT_GLOWS.length)];
