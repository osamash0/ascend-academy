/**
 * The student's own words, cut where the reading found something wrong.
 *
 * Each quote is found case-insensitively, in order of appearance; overlaps
 * keep the first. The result alternates plain text and marked runs, each
 * marked run carrying the index of the correction it belongs to.
 *
 * Pure: no DOM, no React.
 */
export type Run = { text: string; wrong: number | null };

export function annotate(text: string, quotes: string[]): Run[] {
  const lower = text.toLowerCase();
  const hits = quotes
    .map((q, i) => ({ i, at: q.trim() ? lower.indexOf(q.trim().toLowerCase()) : -1, len: q.trim().length }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  const runs: Run[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.at < pos) continue;
    if (h.at > pos) runs.push({ text: text.slice(pos, h.at), wrong: null });
    runs.push({ text: text.slice(h.at, h.at + h.len), wrong: h.i });
    pos = h.at + h.len;
  }
  if (pos < text.length) runs.push({ text: text.slice(pos), wrong: null });
  return runs;
}
