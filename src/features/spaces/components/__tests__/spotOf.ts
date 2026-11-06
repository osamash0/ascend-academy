/**
 * The words the Spotlight would light, read off the overlay a stand-in
 * `PdfPager` is handed. The overlay is a fragment: the Layout layer (when it
 * is on, else `false`) and then the Spotlight, so the words are the Spotlight's.
 *
 * Shared by the reader tests that record the lit words rather than draw them.
 */
export type Overlay = { props?: { children?: unknown } } | undefined;

export function spotOf(overlay: Overlay): string {
  const spot = [overlay?.props?.children].flat().find(
    (k): k is { props: { words?: string | null } } =>
      !!k && typeof k === 'object' && 'props' in k && 'words' in (k as { props: object }).props,
  );
  return spot?.props.words ?? '';
}
