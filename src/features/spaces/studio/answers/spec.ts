import type { FD, Relation } from './fd';

/**
 * An answer composed from parts, not written as one paragraph.
 *
 * The shape is the contract between whatever writes an answer and the canvas
 * that shows it. Every block is plain data, nothing is a function, so a
 * response can arrive one block at a time and the canvas shows each as it
 * lands. The writer picks which blocks a page needs: a comparison side by
 * side, a calculator where trying beats reading, a list of steps where the
 * page is a diagram, or just text. The canvas gives each the same calm base.
 */
export type AnswerBlock =
  /** Prose. Markdown, with maths. */
  | { type: 'text'; md: string }
  /** One sentence that matters more than the rest. */
  | { type: 'key'; md: string }
  /** Two (or three) things side by side. */
  | { type: 'compare'; columns: { title: string; tone?: 'a' | 'b'; points: string[] }[]; note?: string }
  /** A table you can edit, checked live against a dependency. */
  | { type: 'fdTable'; title: string; columns: string[]; rows: string[][]; fd: FD; prompt: string }
  /** X⁺, computed step by step from a start set the reader picks. */
  | { type: 'closure'; title: string; attrs: string[]; fds: FD[]; start: string[] }
  /** A relation split into BCNF, one violating FD at a time. */
  | { type: 'bcnf'; title: string; relation: Relation; fds: FD[] }
  /** A question with an answer the reader commits to before seeing it. */
  | { type: 'check'; question: string; options: { text: string; correct?: boolean; why: string }[] }
  /** Numbered steps, walked one at a time. */
  | { type: 'steps'; title: string; steps: { label: string; body: string }[] };
