/**
 * The reader's per-viewer settings — kept in this browser only.
 *
 * Conveniences (night paper, a pinned contents list, a hint already seen):
 * they can vanish, so every read has a default and every access is guarded.
 */

export interface ReaderPrefs {
  /** Slides drawn dark — for long sessions and late evenings. */
  night: boolean;
  /** The full contents list kept open beside the page. */
  tocPinned: boolean;
  /** The first-visit hint has been seen. */
  hinted: boolean;
}

const KEY = 'ls.reader.prefs.v1';
const DEFAULTS: ReaderPrefs = { night: false, tocPinned: false, hinted: false };

export function readPrefs(): ReaderPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReaderPrefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePrefs(patch: Partial<ReaderPrefs>): ReaderPrefs {
  const next = { ...readPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Storage refused — the setting holds for this visit only. */
  }
  return next;
}
