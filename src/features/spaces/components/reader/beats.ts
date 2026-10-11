/**
 * The beats of a page: the points a scroll steps through, one at a time.
 *
 * Read off the page's parsed text. A list gives one beat per top-level item
 * (its sub-items ride along in the text, not as beats of their own); prose
 * gives one per sentence. Each beat carries the plain words, which are what
 * the spotlight looks for on the page, and a short label for its pill.
 *
 * Pure: no DOM, no React.
 */

export interface Beat {
  /** The words as plain text — matched against the page's text layer. */
  text: string;
  /** A few words for the pill. */
  label: string;
}

/** More than this and the pills stop being a row; the rest are left to the text. */
const MAX_BEATS = 7;
const LABEL_CHARS = 26;

const plain = (s: string) =>
  s
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const labelOf = (text: string) => {
  if (text.length <= LABEL_CHARS) return text;
  const cut = text.slice(0, LABEL_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > 10 ? cut.slice(0, space) : cut).replace(/[,.;:(\s]+$/, '')}…`;
};

export function beatsFromMarkdown(markdown: string): Beat[] {
  const beats: string[] = [];
  let prose = '';
  const flush = () => {
    if (!prose) return;
    for (const sentence of prose.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const t = plain(sentence);
      if (t.length >= 4) beats.push(t);
    }
    prose = '';
  };

  for (const line of markdown.split('\n')) {
    const top = /^[-*+]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (top) {
      flush();
      const t = plain(top[1]);
      if (t.length >= 2) beats.push(t);
    } else if (/^\s+([-*+]|\d+[.)])\s+/.test(line)) {
      // A sub-item: part of the point above it, not a point of its own.
    } else if (line.trim()) {
      prose += `${prose ? ' ' : ''}${line.trim()}`;
    } else {
      flush();
    }
  }
  flush();

  return beats.slice(0, MAX_BEATS).map((text) => ({ text, label: labelOf(text) }));
}
