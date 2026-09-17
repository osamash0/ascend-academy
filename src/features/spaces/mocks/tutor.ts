/**
 * The tutor, canned.
 *
 * This is the swap seam. Everything else the tutor touches — the panel, the
 * thread, the citations that turn back into the Lesson — is real code against
 * a real shape; only the answers are written down in advance. Wiring a model
 * later replaces this module and nothing above it.
 *
 * Three decisions worth naming:
 *
 *   • **Deterministic, and no clock in the reply.** The same question returns
 *     the same words, so a test can assert them. A mock that shuffled between
 *     three plausible answers would be a mock nobody could write a guard
 *     against, and the guards are the reason for building against fixtures at
 *     all.
 *   • **The latency is real.** It resolves on a timer rather than
 *     synchronously, because the pending state is a state the panel has to
 *     render and a promise that is already settled never lets it. Short
 *     enough that the suite does not crawl.
 *   • **A citation is a pointer, not a footnote.** Every `conceptId` is a
 *     Concept of the Lesson it answers about and every `materialPage` is a
 *     page that Lesson's Material actually has — guarded in
 *     `mocks/__tests__/reader.test.ts`. A citation naming something that does
 *     not exist would render as a control leading nowhere, which is the exact
 *     failure the Source view's sync line was rebuilt to remove.
 *
 * The replies never claim to be grounded. Saying "based on your Material" in
 * prose is the model asserting its own trustworthiness; the citation chips
 * show where the answer came from structurally, and the marker at the top of
 * the panel is the Space's claim rather than the answer's. Doc 1 locks that
 * split: grounding is chrome, not prose.
 */

/** Where an answer came from. Exactly one of the two ids is set. */
export interface TutorCitation {
  /** What the chip reads. A Concept's name, or "Material · page N". */
  label: string;
  /** A `Concept.id` of the Lesson being asked about. */
  conceptId?: string;
  /** A `MaterialPage.page` of that Lesson's Material. */
  materialPage?: number;
}

export interface TutorReply {
  text: string;
  citations: TutorCitation[];
}

/**
 * One canned answer and the question that reaches it.
 *
 * Matched on substrings rather than on the exact quick-prompt string, so
 * somebody typing "explain that more simply" lands on the same answer as the
 * chip. Order matters — the first match wins, and the quote-carrying exchange
 * is first because a selection is the most specific thing a question can have.
 */
export interface TutorExchange {
  match: (question: string, quote?: string) => boolean;
  reply: TutorReply;
}

/**
 * Exported for the fixture guard, not for the UI.
 *
 * Every other fixture in this namespace is checked for internal consistency,
 * and this one has two ways to rot that nothing else would notice: a citation
 * pointing at an id the Lesson does not have, and a page number past the end
 * of the Material. Both render as a chip that looks fine and goes nowhere.
 */
export const tutorScripts: Record<string, TutorExchange[]> = {
  'l-s-dbs-4': [
    {
      match: (_q, quote) => Boolean(quote),
      reply: {
        text:
          'The line you picked out is doing the work of a definition, so read it as one: it has to hold for every row the table will ever contain, not only the rows in front of you. The way to test it is to try to invent a row that breaks it. If you can, the dependency was never there — you were reading a coincidence in the data you happened to have.',
        citations: [
          { label: 'Functional dependency', conceptId: 'c-l-s-dbs-4-1' },
          { label: 'Material · page 2', materialPage: 2 },
        ],
      },
    },
    {
      match: (q) => /simpl|plain|shorter/.test(q),
      reply: {
        text:
          'Store one fact in one place. Each normal form is that sentence made stricter: 1NF says a cell holds one value rather than a list, 2NF says a fact about part of a key belongs beside that part, and 3NF says a fact about a non-key attribute belongs beside that attribute. Every step moves a repeated fact somewhere it is written down once.',
        citations: [
          { label: 'First normal form', conceptId: 'c-l-s-dbs-4-2' },
          { label: 'Material · page 1', materialPage: 1 },
        ],
      },
    },
    {
      match: (q) => /example|concrete|show me/.test(q),
      reply: {
        text:
          'Take an order-line table keyed on (order, product) that also carries the product name. The name depends on the product alone, so it repeats on every line that mentions that product. Rename the product and you have to find all of them; miss one and two rows now disagree about the same thing. Move the name into its own relation and the fact is stored once.',
        citations: [
          { label: 'Second normal form', conceptId: 'c-l-s-dbs-4-3' },
          { label: 'Material · page 8', materialPage: 8 },
        ],
      },
    },
    {
      match: (q) => /matter|why|point|bother/.test(q),
      reply: {
        text:
          'Because a table that repeats a fact can be made to contradict itself. The anomalies are all the same bruise seen from three sides: an insert that needs data you do not have yet, an update that lands on some copies and not the others, a delete that takes an unrelated fact away with it. Normal forms are the sequence of guarantees that removes the repetition those depend on.',
        citations: [
          { label: 'Third normal form', conceptId: 'c-l-s-dbs-4-4' },
          { label: 'Material · page 1', materialPage: 1 },
        ],
      },
    },
  ],
};

/**
 * What comes back when nothing is scripted.
 *
 * It carries no citations, and that is the honest shape rather than a gap:
 * there is nothing here it could point at. A fallback that named a Concept
 * anyway would make the chips decorative, and a decorative citation is worse
 * than none — it teaches the reader that pressing one is not worth the trip.
 */
export const tutorFallback: TutorReply = {
  text:
    'Work it from the definition outward. State what the idea has to be true of, then look for the smallest case where it fails — that failure is almost always the thing the idea was invented to prevent, and it is far easier to remember than the rule itself.',
  citations: [],
};

/**
 * Long enough that the pending state is a state somebody sees, short enough
 * that a suite waiting on it stays quick. Tests wait for the reply rather than
 * for this number — nothing may depend on the wall clock.
 */
const LATENCY_MS = 320;

const replyFor = (lessonId: string, question: string, quote?: string): TutorReply => {
  const q = question.toLowerCase();
  return (
    (tutorScripts[lessonId] ?? []).find((e) => e.match(q, quote))?.reply ?? tutorFallback
  );
};

/**
 * Ask about a Lesson.
 *
 * Never rejects: the fixture has no failure to model. The panel still renders
 * a failed turn, because this signature is the one a network call will keep
 * and the first thing a network adds is a way to fail — an error branch built
 * after the fact is an error branch built while somebody is looking at a
 * blank panel wondering what happened.
 */
export function askTutor(
  lessonId: string,
  question: string,
  quote?: string,
): Promise<TutorReply> {
  const reply = replyFor(lessonId, question, quote);
  return new Promise((resolve) => {
    setTimeout(() => resolve(reply), LATENCY_MS);
  });
}
