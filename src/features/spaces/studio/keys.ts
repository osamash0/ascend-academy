/** Shared guards for Studio's window-level keys (O, ← →). */

/** Focus is in something you type into: keys are words, not commands. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** A dialog (Full page) owns its own keys; the page behind it must not react. */
export const inDialog = (t: EventTarget | null) => t instanceof Element && !!t.closest('[role="dialog"]');
