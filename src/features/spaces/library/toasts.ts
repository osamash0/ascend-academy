/**
 * Toasts raised while Select is open sit above its bar, so they never cover
 * Done. Sonner places a toast at the bottom of its stack; a bottom margin
 * lifts it by the bar's height plus a gap (the Toaster lives outside this
 * namespace, so the lift travels with each toast).
 */
export const ABOVE_SELECT_BAR = { style: { marginBottom: 72 } } as const;
