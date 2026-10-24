import { itemById } from '@/features/avatar/catalog';

/**
 * The four lights first run offers. Each is a visor (the ring Luna's live head
 * actually draws, so the pick is visible at once) with a suit that suits it.
 * All free in the catalog, so the server's unlock guard accepts them for a
 * brand-new account. The purple visors (violet, mauve) are left to the Suit
 * Locker: the stage never takes a purple light.
 */
export const LIGHTS = [
  { visor: 'visor-teal', suit: 'suit-moonlight' },
  { visor: 'visor-amber', suit: 'suit-moonlight' },
  { visor: 'visor-rose', suit: 'suit-blush' },
  { visor: 'visor-tide', suit: 'suit-tide' },
] as const;

export type Light = (typeof LIGHTS)[number];

/** The colour a light paints the room, her halo and the progress lights. */
export const lightColor = (light: Light): string => itemById(light.visor)?.color ?? '#88B0B5';
