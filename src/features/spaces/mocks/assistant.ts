/**
 * What Luna offers to be asked, on Home.
 *
 * Mock only. There is no assistant behind this yet, and the UI says so rather
 * than implying one — see `HomeScreen`, where a submitted question is
 * acknowledged instead of answered.
 *
 * The prompts are a learner's, not an Owner's. The screen this was ported from
 * suggests "Which lectures lose the most students?" and "Where are students
 * most confused?", which are questions somebody asks *about a cohort*. Home is
 * one person deciding what to do in the next twenty minutes, so every prompt
 * here is answerable from that person's own Spaces and phrased in the first
 * person. Two of the original's three nouns are also banned words, which is the
 * cheaper reason and not the real one.
 */

/** Offered under the bar. Three at most — a wall of chips is a menu, not a hint. */
export const askSuggestions: readonly string[] = [
  'What should I review first?',
  'Explain Basics more simply',
  'Quiz me on Database Systems',
];

/** Named, not chosen. The picker belongs in Settings, where it already lives. */
export const askModel = 'auto';

/**
 * What comes back today: nothing, said plainly.
 *
 * A fabricated answer would be the worst thing this screen could do — it is an
 * assistant grounded on the person's own material, so an invented reply is
 * indistinguishable from a wrong one. Until there is a backend, the honest
 * response is to name the question and admit it cannot answer yet.
 */
export const askAcknowledgement = (question: string) =>
  `Not wired up yet — I can’t answer “${question}” until the assistant is connected.`;
