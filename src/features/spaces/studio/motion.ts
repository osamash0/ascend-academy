/** Studio's motion vocabulary (spec §4). One place, so Peek, Morph and the flash agree. */
export const FLIGHT_EASE = [0.2, 0.8, 0.2, 1] as const;
export const FLIGHT_S = 0.6;
export const STAGGER_S = 0.045;
export const GLIDE_S = 0.25;
export const TEXT_FADE_S = 0.24;
/** Amber in rgba because Motion cannot interpolate `var()`. Matches --studio-mark. */
export const FLASH_FRAMES = ['rgba(239,159,39,0.28)', 'rgba(239,159,39,0.28)', 'rgba(239,159,39,0)'];
