/**
 * Cover art, from an id.
 *
 * The handoff calls covers load-bearing and requires a mandatory fallback:
 * hash the Space id to one of ~8 dark gradient pairs plus a large low-opacity
 * initial. These are the mock's `G` palette verbatim, because it is named as
 * the reference and because a re-mixed palette would be a different design.
 *
 * **Hashed, not indexed.** The console's existing `gradientFor(index)` keys on
 * a position in a list, so a Space's cover changed when the list reordered —
 * sorting by name gave you a different colour than sorting by activity. The
 * spec is explicit: *same space = same gradient always*. An id is the only
 * thing about a Space that does not move.
 *
 * Plain CSS gradients rather than Tailwind classes: these are radial with
 * three stops and specific positions, which arbitrary-value utilities express
 * badly, and the mock's exact values are the thing being matched.
 */

export const COVERS = {
  indigo: 'radial-gradient(120% 130% at 70% 30%, #4b5dd6 0%, #1a1f4d 52%, #0a0c1e 100%)',
  ember: 'radial-gradient(130% 140% at 65% 35%, #e0713a 0%, #7a2b1c 50%, #170a08 100%)',
  moss: 'radial-gradient(120% 130% at 70% 30%, #3fae72 0%, #14503a 52%, #071510 100%)',
  plum: 'radial-gradient(125% 135% at 68% 30%, #b04fd8 0%, #4a1a63 52%, #12081a 100%)',
  steel: 'radial-gradient(120% 130% at 70% 30%, #5f7f9e 0%, #22303e 54%, #0a0e12 100%)',
  gold: 'radial-gradient(125% 130% at 68% 30%, #d8a53f 0%, #6b4a12 52%, #150f05 100%)',
  rose: 'radial-gradient(125% 135% at 68% 30%, #d84f6e 0%, #63182b 52%, #17070c 100%)',
  cyan: 'radial-gradient(120% 130% at 70% 30%, #3fb8d8 0%, #14495f 52%, #071216 100%)',
} as const;

/** The neutral one, for Discover. Not in the hash — it is not a Space. */
export const SLATE_COVER =
  'radial-gradient(120% 130% at 55% 15%, #32384a 0%, #171a22 55%, #0a0b0d 100%)';

const PALETTE = Object.values(COVERS);

/**
 * Stable across sessions and across list order.
 *
 * A plain 31-multiplier string hash — the same one `joinCodeFor` uses, for the
 * same reason: it needs to be deterministic and readable, not cryptographic.
 */
export const coverFor = (id: string): string => {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
};

/**
 * The letter behind the art.
 *
 * The mock draws one enormous low-opacity initial per cover. It is decoration,
 * never information — the name is always rendered as text as well — so every
 * call site marks it `aria-hidden`.
 */
export const initialFor = (name: string): string => name.trim().charAt(0).toUpperCase();
