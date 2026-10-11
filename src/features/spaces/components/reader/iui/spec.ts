import type { FD, Relation } from './fd';

/**
 * Explain: an answer composed from parts, not written as one paragraph.
 *
 * The shape is the contract between whatever writes an answer and the panel
 * that shows it. Today the writer is `mocks/explain.ts` — authored answers
 * for the Normalization Lesson, and a composer that builds one for any other
 * page from its parsed text. Tomorrow it is a model asked to answer in this
 * JSON: every block is plain data, nothing is a function, so a response can
 * arrive one block at a time and the panel shows each as it lands.
 *
 * The blocks are a small library on purpose. The writer chooses which ones a
 * page needs — a comparison side by side, a calculator where trying beats
 * reading, a list of parts where the slide is a diagram, or just text — and
 * the panel gives every one of them the same calm foundation.
 */

export type ExplainBlock =
  /** Prose. Markdown, with maths. */
  | { type: 'text'; md: string }
  /** One sentence that matters more than the rest. */
  | { type: 'key'; md: string }
  /**
   * The slide as a thing with parts. Each part has a pill; choosing one says
   * what it does and lights the same words on the page (`spot`).
   */
  | {
      type: 'explore';
      title: string;
      intro: string;
      parts: { id: string; label: string; body: string; spot?: string }[];
      /** Draw the parts as a chain of stages rather than a set of pills. */
      flow?: boolean;
    }
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
  | { type: 'steps'; title: string; steps: { label: string; body: string }[] }
  /**
   * A small app the model wrote, for what no block above can show — a B+-tree
   * to insert into, a schedule to run. Runs isolated (`Sandbox.tsx`).
   */
  | { type: 'sandbox'; title: string; caption?: string; height?: number; html: string; css: string; js: string };

export interface ExplainAnswer {
  /** The answer's headline — what this page is about, said plainly. */
  title: string;
  /** Which way the writer chose to answer, in a few words: "A tool to try", "Side by side". */
  format: string;
  blocks: ExplainBlock[];
  /** Follow-ups the reader can take from here. */
  next?: string[];
}
