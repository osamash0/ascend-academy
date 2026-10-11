/**
 * Find a sentence inside an element, as a Range.
 *
 * The two faces carry the same words in different markup — the PDF's text
 * layer is a spray of absolutely positioned spans, the column is paragraphs
 * and list items — so the match is made on the *text*, with whitespace
 * collapsed, and then mapped back onto the text nodes that hold it. Pure DOM,
 * no React.
 *
 * Returns null when the words are not there, which is a normal outcome: the
 * authored prose on the definition pages has no counterpart on the page, and
 * a scanned page has no text layer at all.
 */
export function findRange(container: Element, text: string): Range | null {
  const whole = text.replace(/\s+/g, ' ').trim().slice(0, 160).toLowerCase();
  if (whole.length < 4) return null;
  /*
   * The whole selection first; failing that, its opening words. A selection
   * in the column often runs across a nested list, and on the page those
   * lines are interleaved with numbering and bullet glyphs — so the whole
   * string is not there, but its first clause is. Finding the start of the
   * sentence is the point of the gesture; finding all of it is a bonus.
   */
  const candidates = [whole, whole.slice(0, 48).trim(), whole.slice(0, 24).trim()].filter(
    (c, i, all) => c.length >= 4 && all.indexOf(c) === i,
  );
  for (const needle of candidates) {
    const found = findExact(container, needle);
    if (found) return found;
  }
  return null;
}

function findExact(container: Element, needle: string): Range | null {

  /*
   * One collapsed string of the container's text, with a map from each kept
   * character back to the text node and offset it came from.
   */
  const owners: Text[] = [];
  const offsets: number[] = [];
  let hay = '';
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const raw = node.data;
    for (let i = 0; i < raw.length; i++) {
      const ws = /\s/.test(raw[i]);
      if (ws && (hay.length === 0 || hay[hay.length - 1] === ' ')) continue;
      hay += ws ? ' ' : raw[i];
      owners.push(node);
      offsets.push(i);
    }
    node = walker.nextNode() as Text | null;
  }

  const at = hay.toLowerCase().indexOf(needle);
  if (at === -1) return null;
  const end = at + needle.length - 1;

  const range = document.createRange();
  range.setStart(owners[at], offsets[at]);
  range.setEnd(owners[end], offsets[end] + 1);
  return range;
}
