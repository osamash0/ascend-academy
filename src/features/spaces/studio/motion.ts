/** Studio's motion vocabulary (spec §4). One place, so Peek, Morph and the flash agree. */
export const FLIGHT_EASE = [0.2, 0.8, 0.2, 1] as const;
export const FLIGHT_S = 0.6;
export const STAGGER_S = 0.045;
export const GLIDE_S = 0.25;
export const TEXT_FADE_S = 0.24;
/** Amber in rgba because Motion cannot interpolate `var()`. Matches --studio-mark. */
export const FLASH_FRAMES = ['rgba(239,159,39,0.28)', 'rgba(239,159,39,0.28)', 'rgba(239,159,39,0)'];

/** Living Learn: an answer grows into the page (spec §4.3). */
export const GROW_S = 0.7;
export const RULE_S = 0.9;
export const WORD_S = 0.55;
export const WORD_STAGGER_S = 0.055;
/** No answer takes longer than this to start its last word. */
export const WORD_BUDGET_S = 1.6;
/** After this many words, the rest settle sentence by sentence. */
export const WORD_LIMIT = 40;
/** Each part of a shaped answer arrives this long after the one before. */
export const BLOCK_STAGGER_S = 0.28;
export const BLOCK_S = 0.4;
export const COLLAPSE_S = 0.4;
export const GLOW_FADE_S = 0.8;
/** Teal in rgba because Motion cannot interpolate `var()`. Matches --studio-woven (dark). */
export const GLOW_ON = 'rgba(159,211,199,0.06)';
export const GLOW_OFF = 'rgba(159,211,199,0)';
/** The light theme's teal is deeper, or the glow would be invisible on paper. */
export const GLOW_ON_LIGHT = 'rgba(47,125,109,0.10)';
export const GLOW_OFF_LIGHT = 'rgba(47,125,109,0)';
export const glowColors = (theme: 'light' | 'dark') =>
  theme === 'light' ? { on: GLOW_ON_LIGHT, off: GLOW_OFF_LIGHT } : { on: GLOW_ON, off: GLOW_OFF };

/** Answer cards: a chip pulse or a card settling into place. */
export const CARD_SETTLE_S = 0.3;
/** Answer cards: a verdict or a reason fading in. */
export const MARK_FADE_S = 0.2;

/** One Library §5.4: a cover grows to the window, and the shelf steps back behind it. */
export const ZOOM_S = 0.45;
export const RECEDE_S = 0.3;
/** The page taking over from that frame. */
export const PAGE_ENTER_S = 0.35;
