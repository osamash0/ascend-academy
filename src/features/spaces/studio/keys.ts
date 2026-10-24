/** Shared guards for window-level keys: the page's (S, ← →) and the shelf's (U, /). */

/** Focus is in something you type into: keys are words, not commands. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** A dialog (Full page) owns its own keys; the page behind it must not react. */
export const inDialog = (t: EventTarget | null) => t instanceof Element && !!t.closest('[role="dialog"]');

/**
 * A menu is open (a Share or cover menu): its own arrow keys move within it,
 * so the page behind must not turn. Checked by the page turns (← →) only; a
 * menu that is open anywhere counts, since Radix may keep focus on its trigger.
 */
export const menuOpen = (t: EventTarget | null) =>
  (t instanceof Element && !!t.closest('[role="menu"]')) || !!document.querySelector('[role="menu"]');
