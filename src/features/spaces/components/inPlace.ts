/**
 * Navigation state for a move made in place, without the route fade: a file
 * read under its temporary id moving to its real one (the same screen stays
 * mounted, the file is not loaded again), and the early reader handing over
 * to its Lesson (the handover still covers the change, and a fade would mount
 * the Lesson twice — once in the screen fading out, once after).
 */
export const IN_PLACE = { inPlace: true } as const;
export const isInPlace = (state: unknown) => !!(state as { inPlace?: boolean } | null)?.inPlace;
