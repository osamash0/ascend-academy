/**
 * Studio's colours, written out once: the shelf stands on the stage, not the
 * canvas surface, so it cannot read the canvas's CSS variables. Full class
 * strings, so Tailwind sees them.
 */
export const SHELF_TONE = {
  term: 'text-[rgb(243,231,201)]',
  teal: 'bg-[rgb(159,211,199)]',
  tealRule: 'border-[rgb(159,211,199)]',
  amber: 'bg-[rgb(239,159,39)]',
} as const;
