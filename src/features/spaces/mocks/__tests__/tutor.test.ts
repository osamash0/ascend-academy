import { describe, expect, it } from 'vitest';
import { askTutor, tutorFallback, tutorScripts } from '../tutor';
import { allSpaces } from '../spaces';
import { lessonsForSpace } from '../lessons';

/**
 * The canned answers, and the two ways they can rot silently.
 *
 * A citation is a control: press it and the reader is taken to a passage or a
 * page. So a `conceptId` naming an idea the Lesson does not have, or a
 * `materialPage` past the end of the Material, is not a typo in a fixture — it
 * is a button that looks live and goes nowhere, and nothing on either screen
 * would look wrong. The panel refuses to render those as controls, which
 * fixes the symptom; these guards are what stop the fixture drifting into
 * needing that mercy.
 *
 * The other rot is prose. "Grounding is chrome, not prose" is a rule about
 * *these strings* more than about any component — an answer that says "based
 * on your Material" is the model vouching for itself, which is exactly the
 * claim the citation chips exist to make checkable instead.
 */

const everyLesson = allSpaces.flatMap((s) => lessonsForSpace(s.id));
const lessonById = new Map(everyLesson.map((l) => [l.id, l]));

const scripted = Object.entries(tutorScripts);
const everyReply = [...scripted.flatMap(([, xs]) => xs.map((x) => x.reply)), tutorFallback];

describe('a citation points at something that exists', () => {
  it('scripts a Lesson the fixtures actually have', () => {
    expect(scripted.length, 'nothing is scripted, so none of this is vacuous').toBeGreaterThan(0);
    for (const [id] of scripted) expect(lessonById.has(id), `no Lesson ${id}`).toBe(true);
  });

  it('names one target per chip, never both and never neither', () => {
    // The panel branches on which id is set. Two set would make the branch
    // order the decision; neither set is a chip that reads as a control and
    // has nothing to be a control for.
    for (const [id, exchanges] of scripted) {
      for (const { reply } of exchanges) {
        for (const c of reply.citations) {
          const kinds = [c.conceptId, c.materialPage].filter((v) => v !== undefined);
          expect(kinds.length, `${id}: "${c.label}" names ${kinds.length} targets`).toBe(1);
        }
      }
    }
  });

  it('cites only Concepts that Lesson teaches', () => {
    for (const [id, exchanges] of scripted) {
      const ids = new Set(lessonById.get(id)!.concepts.map((c) => c.id));
      for (const { reply } of exchanges) {
        for (const c of reply.citations) {
          if (c.conceptId === undefined) continue;
          expect(ids.has(c.conceptId), `${id} cites unknown ${c.conceptId}`).toBe(true);
        }
      }
    }
  });

  it('cites only pages that Material actually has', () => {
    for (const [id, exchanges] of scripted) {
      const pages = new Set((lessonById.get(id)!.material?.pages ?? []).map((p) => p.page));
      for (const { reply } of exchanges) {
        for (const c of reply.citations) {
          if (c.materialPage === undefined) continue;
          expect(pages.has(c.materialPage), `${id} cites missing page ${c.materialPage}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('labels the chips of one answer distinguishably', () => {
    // Two chips reading the same words under one answer are two controls the
    // reader cannot tell apart, and the panel keys them by that label.
    for (const [id, exchanges] of scripted) {
      for (const { reply } of exchanges) {
        const labels = reply.citations.map((c) => c.label);
        expect(new Set(labels).size, `${id}: "${reply.text.slice(0, 30)}…" repeats a chip`).toBe(
          labels.length,
        );
      }
    }
  });

  it('uses both kinds of citation somewhere, so both branches render', () => {
    const cs = scripted.flatMap(([, xs]) => xs.flatMap((x) => x.reply.citations));
    expect(cs.some((c) => c.conceptId !== undefined), 'no Concept is ever cited').toBe(true);
    expect(cs.some((c) => c.materialPage !== undefined), 'no page is ever cited').toBe(true);
  });
});

describe('the answers are answers, not claims about themselves', () => {
  it('never says where it got the answer in prose', () => {
    /*
     * Doc 1, locked: grounding is chrome. The marker at the top of the panel
     * is the Space's claim and the chips are the evidence; a sentence saying
     * "according to your Material" is the answer asserting its own
     * trustworthiness, which is unfalsifiable and reads as marketing.
     */
    for (const r of everyReply) {
      expect(r.text, `an answer claims groundedness: ${r.text.slice(0, 60)}`).not.toMatch(
        /based on|according to|from your (material|lesson)|in the material|the material says/i,
      );
    }
  });

  it('writes real prose rather than a stub', () => {
    for (const r of everyReply) {
      expect(r.text.length, `a stub answer: ${r.text}`).toBeGreaterThan(180);
      expect(r.text).not.toMatch(/lorem ipsum|TODO|TBD/i);
    }
  });

  it('carries no citation on the fallback, because it has nothing to point at', () => {
    // A decorative chip is worse than none: it teaches the reader that
    // pressing one is not worth the trip.
    expect(tutorFallback.citations).toEqual([]);
  });
});

describe('asking is deterministic and takes time', () => {
  it('answers the same question with the same words', async () => {
    // The whole reason for a canned mock. A reply that varied would be a
    // reply nothing could be asserted against.
    const a = await askTutor('l-s-dbs-4', 'Concrete example');
    const b = await askTutor('l-s-dbs-4', 'Concrete example');
    expect(a).toEqual(b);
  });

  it('reads a question the reader typed, not only the chip that sent it', async () => {
    const chip = await askTutor('l-s-dbs-4', 'Concrete example');
    const typed = await askTutor('l-s-dbs-4', 'can you show me a concrete example?');
    expect(typed.text).toBe(chip.text);
  });

  it('answers a selection differently from the same question without one', async () => {
    // The quote-carrying exchange is first, so a selection outranks whatever
    // else the question happens to contain.
    const plain = await askTutor('l-s-dbs-4', 'Explain more simply');
    const quoted = await askTutor('l-s-dbs-4', 'Explain more simply', 'A → B');
    expect(quoted.text).not.toBe(plain.text);
  });

  it('falls back for a Lesson nobody wrote a script for', async () => {
    expect(await askTutor('l-s-crypto-1', 'Why does this matter?')).toEqual(tutorFallback);
  });

  it('does not resolve in the same tick, so the pending state is real', async () => {
    /*
     * Asserted against microtasks rather than the clock. A promise that is
     * already settled never lets the panel render "Thinking…", and the panel
     * would then be shipping a state nobody had ever seen — but pinning an
     * actual millisecond count here would make the suite depend on the wall
     * clock, which is the other way this goes wrong.
     */
    let settled = false;
    const p = askTutor('l-s-dbs-4', 'Explain more simply').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled, 'the answer arrived before the panel could render a wait').toBe(false);
    await p;
    expect(settled).toBe(true);
  });
});
