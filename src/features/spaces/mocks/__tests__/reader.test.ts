import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allSpaces } from '../spaces';
import { lessonsForSpace } from '../lessons';
import { SURFACES } from '../../components/Scene';

/**
 * The reader, and the passages it renders.
 *
 * Passages are tied to Concepts on purpose: the reader must walk the same
 * objects the map lights, not a parallel structure that happens to live in the
 * same Lesson. A passage naming a Concept that does not exist would render a
 * heading for an idea the map has never heard of, and nothing on either screen
 * would look wrong.
 */

const written = allSpaces
  .flatMap((s) => lessonsForSpace(s.id))
  .filter((l) => (l.passages?.length ?? 0) > 0);

describe('passages describe the ideas the Lesson actually has', () => {
  it('has at least one written Lesson, so none of this is vacuous', () => {
    expect(written.length).toBeGreaterThan(0);
  });

  it('names a real Concept in every passage', () => {
    for (const l of written) {
      const ids = new Set(l.concepts.map((c) => c.id));
      for (const p of l.passages ?? []) {
        expect(ids.has(p.conceptId), `${l.title}: passage for unknown ${p.conceptId}`).toBe(true);
      }
    }
  });

  it('writes each Concept at most once', () => {
    // Two passages for one idea means the reader and the map disagree about
    // how many ideas the Lesson contains.
    for (const l of written) {
      const seen = (l.passages ?? []).map((p) => p.conceptId);
      expect(new Set(seen).size, `${l.title} explains an idea twice`).toBe(seen.length);
    }
  });

  it('covers every Concept it claims to teach', () => {
    // A written Lesson with a gap is worse than an unwritten one: the reader
    // looks complete and silently skips an idea the map still counts.
    for (const l of written) {
      expect((l.passages ?? []).length, `${l.title} leaves an idea unexplained`).toBe(
        l.concepts.length,
      );
    }
  });

  it('keeps the reading order the Concept order', () => {
    for (const l of written) {
      expect((l.passages ?? []).map((p) => p.conceptId)).toEqual(l.concepts.map((c) => c.id));
    }
  });

  it('writes real prose rather than a placeholder', () => {
    /*
     * A reader is a typography surface, and filler lies about line length,
     * paragraph rhythm and how a heading sits against the paragraph under it.
     * Short paragraphs would make the measure look fine when it is not.
     */
    for (const l of written) {
      for (const p of l.passages ?? []) {
        expect(p.body.length, `${p.heading} has no paragraphs`).toBeGreaterThan(0);
        /*
         * The passage as a whole, not every paragraph. The first version
         * required 120 characters per paragraph and failed on "If the key is
         * a single attribute, 2NF is automatic. There is no part of it to
         * depend on." — a deliberate short closing line, and the best
         * sentence in that section. A guard that would be satisfied by
         * padding good prose is measuring the wrong thing.
         */
        const total = p.body.join(' ').length;
        expect(total, `${p.heading} is a stub`).toBeGreaterThan(400);
        for (const para of p.body) {
          expect(para.length, `${p.heading} has an empty paragraph`).toBeGreaterThan(40);
          expect(para, `${p.heading} contains filler`).not.toMatch(/lorem ipsum|TODO|TBD/i);
        }
      }
    }
  });
});

describe('the reader is a focus surface', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/features/spaces/screens/ReaderScreen.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('renders on the plain ground, not the console texture', () => {
    expect(SURFACES.lessonReader).toBe('focus');
    expect(src).toContain('SURFACES.lessonReader');
  });

  it('mounts no top bar', () => {
    // Focus means the chrome comes off. A reader with five destinations
    // across the top is a browse screen with a lot of text on it.
    expect(src).not.toContain('SpacesTopBar');
  });

  it('constrains the measure', () => {
    /*
     * A band, not a number. `ch` is the width of "0" and wider than average
     * lowercase, so the class and the characters-per-line it produces are not
     * the same figure — `65ch` measured 74 in the browser. What matters is
     * that a cap exists and is in the readable range; the exact value is set
     * by measuring, which a test cannot do.
     */
    // The *widest* measure on the screen — the body column. The first
    // version took the first match and got the 46ch of the empty state's
    // centred paragraph, which is narrower on purpose and not the thing
    // being constrained.
    const all = [...src.matchAll(/max-w-\[(\d+)ch\]/g)].map((m) => Number(m[1]));
    expect(all.length, 'the reader has no measure at all').toBeGreaterThan(0);
    const ch = Math.max(...all);
    expect(ch, 'the measure is too narrow').toBeGreaterThanOrEqual(50);
    expect(ch, 'the measure is too wide to read comfortably').toBeLessThanOrEqual(66);
  });

  it('changes no progress', () => {
    /*
     * Marking a Concept read on scroll would invent a progression rule, and
     * Doc 1 locks progression to XP awarded by the engine. What reading does
     * to the map is an open question; a screen must not quietly answer one.
     */
    expect(src).not.toMatch(/setProgress|markRead|grantXp|cleared/i);
  });

  it('always offers a way out', () => {
    expect(src).toContain('Leave the reader');
  });
});
