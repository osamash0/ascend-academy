/** Markdown → readable plain text, for labels and the text that flies. */
export function plainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstWords(md: string, n = 6): string {
  const words = plainText(md).split(' ');
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
}
