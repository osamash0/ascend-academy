/**
 * Back from a page, focus comes home to the cover you opened (spec §5.4).
 *
 * One module-level note, so it survives the route change however you leave
 * the page: its Back link, the breadcrumb, or the browser's Back. The shelf
 * takes it once, on arrival. (The reverse zoom is not played: Back is a plain
 * route change; only focus is returned.)
 */

let opened: { id: string; via: 'cover' | 'continue' } | null = null;

/** A page was opened (or arrived at). `via` names which of its two links on the shelf to come back to. */
export const rememberOpened = (id: string, via?: 'cover' | 'continue'): void => {
  // The page itself reports its id on arrival; it keeps how the shelf opened it.
  if (opened?.id === id && !via) return;
  opened = { id, via: via ?? 'cover' };
};

/**
 * The link to focus on the shelf, taken once (found or not): the one you
 * opened, else any link to the same page. null when there is nothing to return to.
 */
export const takeReturnTarget = (root: ParentNode = document): HTMLElement | null => {
  const o = opened;
  if (!o) return null;
  const href = `a[href="/v4/library/m/${o.id}"]`;
  const el =
    root.querySelector<HTMLElement>(`${href}[data-opened-via="${o.via}"]`) ??
    root.querySelector<HTMLElement>(href);
  opened = null;
  return el;
};

/** Test seam. */
export const __resetReturn = (): void => {
  opened = null;
};
