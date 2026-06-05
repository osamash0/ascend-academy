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
  'from-indigo-500/40 via-purple-600/30 to-slate-900',
  'from-cyan-500/40 via-blue-600/30 to-slate-900',
  'from-rose-500/40 via-pink-600/30 to-slate-900',
  'from-amber-500/40 via-orange-600/30 to-slate-900',
  'from-emerald-500/40 via-teal-600/30 to-slate-900',
  'from-violet-500/40 via-fuchsia-600/30 to-slate-900',
];

/** Ambient page-glow color keyed to a status. */
export const GLOW_BY_STATUS: Record<ConsoleStatus, string> = {
  done: 'rgba(34,197,94,0.18)',
  progress: 'rgba(99,102,241,0.20)',
  new: 'rgba(168,85,247,0.18)',
};

/**
 * Ambient page-glow color keyed to the focused item, aligned 1:1 with
 * COVER_GRADIENTS so the background light responds to the same color the
 * focused card shows (indigo → cyan → rose → amber → emerald → violet).
 */
export const ACCENT_GLOWS = [
  'rgba(99,102,241,0.28)', // indigo
  'rgba(6,182,212,0.28)', // cyan
  'rgba(244,63,94,0.28)', // rose
  'rgba(245,158,11,0.28)', // amber
  'rgba(16,185,129,0.28)', // emerald
  'rgba(139,92,246,0.28)', // violet
];

const wrap = (index: number, len: number) => ((index % len) + len) % len;

export const gradientFor = (index: number) =>
  COVER_GRADIENTS[wrap(index, COVER_GRADIENTS.length)];

/** Ambient glow color for the focused gradient index (matches gradientFor). */
export const accentGlowFor = (index: number) =>
  ACCENT_GLOWS[wrap(index, ACCENT_GLOWS.length)];
