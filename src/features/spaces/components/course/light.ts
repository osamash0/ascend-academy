/**
 * Which of a lecture's ideas your rehearsals have lit.
 *
 * Doc 2's rule, finally with real data under it: darkness is the content —
 * an idea nobody has tested you on stays unlit. A rehearsal answer is filed
 * under the idea whose pages contain the page it asked about (the question's
 * own wording of the idea is the model's, so it is not trusted to match).
 * Any latest-wrong answer inside an idea marks it to revisit; otherwise a
 * right one lights it.
 *
 * Pure: no DOM, no React.
 */

export type Light = 'lit' | 'weak' | 'dark';

export interface Mark {
  lecture_id: string;
  page: number;
  correct: boolean;
}

/** The index of the idea a page belongs to: the last one starting at or before it. */
export function ideaAt(ideas: { first_page: number }[], page: number): number {
  let at = -1;
  ideas.forEach((idea, i) => {
    if (idea.first_page <= page && (at < 0 || idea.first_page >= ideas[at].first_page)) at = i;
  });
  return at;
}

export function lightIdeas(lectureId: string, ideas: { first_page: number }[], marks: Mark[]): Light[] {
  const out: Light[] = ideas.map(() => 'dark');
  for (const m of marks) {
    if (m.lecture_id !== lectureId) continue;
    const i = ideaAt(ideas, m.page);
    if (i < 0) continue;
    if (!m.correct) out[i] = 'weak';
    else if (out[i] === 'dark') out[i] = 'lit';
  }
  return out;
}
