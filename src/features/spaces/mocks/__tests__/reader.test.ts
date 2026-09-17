import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allSpaces } from '../spaces';
import { lessonsForSpace } from '../lessons';
import { SURFACES } from '../../components/Scene';
import { sourceFiles } from '../../components/__tests__/sources';

/**
 * The reader, and the passages it renders.
 *
 * Passages are tied to Concepts on purpose: the reader must walk the same
 * objects the map lights, not a parallel structure that happens to live in the
 * same Lesson. A passage naming a Concept that does not exist would render a
 * heading for an idea the map has never heard of, and nothing on either screen
 * would look wrong.
 */

const everyLesson = allSpaces.flatMap((s) => lessonsForSpace(s.id));

const written = everyLesson.filter((l) => (l.passages?.length ?? 0) > 0);

const paginated = everyLesson.filter((l) => (l.material?.pages?.length ?? 0) > 0);

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

  it('writes no markup the renderer cannot honour', () => {
    /*
     * Found on screen, not in a review: `l-s-crypto-6` shipped twelve literal
     * grave accents. Its author wrote Markdown code spans — `var("x, y")`,
     * `2^10` — and `ReaderScreen` renders a paragraph as a plain text node, so
     * every one of them was a backtick a reader could see. The length and
     * filler rules above have no opinion about punctuation, and neither did
     * anything else in the suite.
     *
     * The rule belongs to the renderer rather than to that fixture, which is
     * why it sweeps every written Lesson: whoever writes the next passage will
     * reach for the same convention. The day passages *do* render code spans
     * is the day this test is deleted on purpose, rather than the day it
     * quietly stopped meaning anything.
     *
     * The Material's pages take the same plain-text path, so they are held to
     * the same rule.
     */
    const MARKUP = /`|\*\*|\[[^\]]+\]\([^)]+\)/;
    const say = (where: string, text: string) =>
      expect(text, `${where} carries markup that renders as itself`).not.toMatch(MARKUP);

    for (const l of written) {
      for (const p of l.passages ?? []) {
        say(`${l.title} / ${p.heading}`, p.heading);
        for (const para of p.body) say(`${l.title} / ${p.heading}`, para);
      }
    }
    for (const l of paginated) {
      for (const page of l.material?.pages ?? []) {
        say(`${l.title} / page ${page.page}`, page.title);
        for (const b of page.bullets) say(`${l.title} / page ${page.page}`, b);
      }
    }
  });
});

describe('the Material describes the same ideas the Lesson does', () => {
  it('has at least one paginated Material, so none of this is vacuous', () => {
    expect(paginated.length).toBeGreaterThan(0);
  });

  it('names a real Concept on every page', () => {
    /*
     * The same rule the passages keep, for the same reason. A page pointing at
     * an id the Lesson does not have renders "This page belongs to …" with
     * nothing to name, and the only two screens that could notice are the two
     * that both read this fixture.
     */
    for (const l of paginated) {
      const ids = new Set(l.concepts.map((c) => c.id));
      for (const p of l.material!.pages!) {
        expect(ids.has(p.conceptId), `${l.title} p${p.page}: unknown ${p.conceptId}`).toBe(true);
      }
    }
  });

  it('numbers the pages contiguously from 1', () => {
    // The number on the card is the number in the file. A gap means the pager
    // says "7 / 12" on the eighth page, and nothing else would ever say so.
    for (const l of paginated) {
      const numbers = l.material!.pages!.map((p) => p.page);
      expect(numbers, `${l.title} is not paged 1..n`).toEqual(
        Array.from({ length: numbers.length }, (_, i) => i + 1),
      );
    }
  });

  it('walks the Concepts in order and does not come back to one', () => {
    /*
     * Pages are grouped by idea and the groups run in Concept order — which is
     * passage order too, since the passages are guarded to be. Interleaved
     * pages would still resolve, and the sync line would flicker between two
     * ideas as you turned a page, describing a file nobody has.
     */
    for (const l of paginated) {
      const order = l.concepts.map((c) => c.id);
      const groups = l.material!.pages!.map((p) => p.conceptId).filter((id, i, a) => id !== a[i - 1]);
      expect(new Set(groups).size, `${l.title} returns to an idea it left`).toBe(groups.length);
      expect(groups, `${l.title} pages its ideas out of order`).toEqual(
        order.filter((id) => groups.includes(id)),
      );
    }
  });

  it('writes real lines rather than a placeholder', () => {
    for (const l of paginated) {
      for (const p of l.material!.pages!) {
        expect(p.title.trim().length, `${l.title} p${p.page} has no title`).toBeGreaterThan(0);
        // Three or four. One bullet is a sentence with a dot in front of it,
        // and a card of eight is a wall the layout was never sized for.
        expect(p.bullets.length, `${l.title} p${p.page} bullet count`).toBeGreaterThanOrEqual(3);
        expect(p.bullets.length, `${l.title} p${p.page} bullet count`).toBeLessThanOrEqual(4);
        for (const b of p.bullets) {
          expect(b.length, `${l.title} p${p.page} has a stub bullet`).toBeGreaterThan(20);
          expect(b, `${l.title} p${p.page} contains filler`).not.toMatch(/lorem ipsum|TODO|TBD/i);
        }
      }
    }
  });

  it('has a Lesson whose file was deleted, so the fourth shape is reachable', () => {
    /*
     * That deleting the Material takes the pages with it is the whole argument
     * for `pages` living on `Material` rather than on `Lesson`, and it is
     * enforced by the type: `material: null` has no `pages` to read, so
     * `lesson.material?.pages ?? []` is `[]` and the Source view cannot exist.
     * There is nothing here for a test to catch — an earlier version of this
     * one looped over the deleted Lessons asserting that constant `[]` was
     * empty, which tested optional chaining and reported it as fixture
     * coverage.
     *
     * What is worth pinning is that such a Lesson exists at all. Without one
     * the fourth shape has never rendered, and three of the four branches
     * would be carrying a test suite that looks complete.
     */
    expect(
      everyLesson.filter((l) => l.material === null).length,
      'no deleted-source fixture, so the fourth shape is untested',
    ).toBeGreaterThan(0);
  });
});

describe('the reader has a fixture for each shape it renders', () => {
  /*
   * Four shapes, and three of them used to render the same apology. Each needs
   * a fixture or the branch that handles it has never executed — the Material-
   * without-prose case in particular exists *because* the dead end was wrong,
   * so it is the one most likely to be built and never seen.
   *
   * There were three `it`s under this comment for a while, and the fourth
   * shape was assumed to be covered by the deleted-source assertion above.
   * It was not: that one pins `material === null`, and *both* such fixtures
   * also had no passages, so it was a second reading of the `-/-` row. The
   * text-and-no-Material branch had no fixture at all while the count in this
   * comment said otherwise.
   */
  const shape = (l: (typeof everyLesson)[number]) =>
    `${(l.passages?.length ?? 0) > 0 ? 'text' : '-'}/${
      (l.material?.pages?.length ?? 0) > 0 ? 'pages' : '-'
    }`;

  it('has a Lesson with both a text and a Material', () => {
    expect(everyLesson.filter((l) => shape(l) === 'text/pages').length).toBeGreaterThan(0);
  });

  it('has a Lesson with a Material and no text — the one that replaces a dead end', () => {
    expect(everyLesson.filter((l) => shape(l) === '-/pages').length).toBeGreaterThan(0);
  });

  it('has a Lesson with neither, which is still honestly unwritten', () => {
    expect(everyLesson.filter((l) => shape(l) === '-/-').length).toBeGreaterThan(0);
  });

  it('has a Lesson with a text and no Material, with the file genuinely gone', () => {
    /*
     * `material: null` rather than merely "a Material nobody has paged", and
     * the distinction is the point: the second is a pipeline that has not
     * finished, the first is a source that was deleted. Only the first proves
     * the reader survives losing the file it was built from.
     */
    const readOnly = everyLesson.filter((l) => shape(l) === 'text/-');
    expect(readOnly.length, 'no text-only fixture, so the Read-only branch is untested')
      .toBeGreaterThan(0);
    expect(
      readOnly.some((l) => l.material === null),
      'every text-only fixture still has its Material, so the deleted-source case is unread',
    ).toBe(true);
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

  it('changes no progress, in any file the reader is made of', () => {
    /*
     * Marking a Concept read on scroll would invent a progression rule, and
     * Doc 1 locks progression to XP awarded by the engine. What reading does
     * to the map is an open question; a screen must not quietly answer one.
     *
     * This guard used to read `ReaderScreen.tsx` and nothing else, which was
     * the whole reader right up until it wasn't. The chrome moved out to
     * `components/reader/`, and the rule silently stopped covering the code it
     * was written for — `sources.ts` says why that failure mode is worse than
     * having no guard at all. So it sweeps the directory, and every file added
     * beside the header is inside the net on the day it lands.
     */
    const reader = [
      { name: 'screens/ReaderScreen.tsx', body: src },
      ...sourceFiles('components/reader'),
    ];
    expect(reader.length, 'the sweep found nothing, so it proves nothing').toBeGreaterThan(1);
    for (const { name, body } of reader) {
      expect(body, `${name} moves progress`).not.toMatch(
        /setProgress|markRead|grantXp|awardBadge/i,
      );
    }
  });

  it('never says a Concept is cleared from the screen itself', () => {
    /*
     * Narrower than the sweep above and deliberately kept apart from it. The
     * header *displays* what the engine already cleared — `progress ===
     * 'cleared'`, and "N of M ideas cleared" — so the word is legitimate there
     * and folding the two rules together would redden correct code.
     *
     * On the screen it is still a smell: `ReaderScreen` composes and routes,
     * and has no reason to reason about a Concept's standing.
     */
    expect(src).not.toMatch(/cleared/i);
  });

  it('keeps the way out in the bar, where it cannot scroll away', () => {
    /*
     * The exit used to be a `<Link>` written into the article, so this guard
     * read the screen for the string. It now lives in the fixed header — the
     * whole reason the header exists is that a way out which scrolls off the
     * top of a long Lesson is a way out you have to go looking for.
     *
     * So the rule is checked across the composition rather than in one file:
     * the screen mounts the header, and the header carries the exit. Asserting
     * only the second half would pass on a reader that had stopped mounting it
     * at all.
     *
     * It used to be called "always offers a way out", and it did not check
     * that. The header exists on one of the reader's four branches; the
     * skeleton and the failure had no exit at all while this sat green above
     * them. "Always" is now asserted where it can be — per branch, rendered,
     * in `components/__tests__/readerStates.test.tsx` — and this keeps the
     * narrower rule it actually holds: that the branch which reads carries its
     * exit in chrome that does not move.
     */
    expect(src).toContain('<ReaderHeader');
    const header = readFileSync(
      join(process.cwd(), 'src/features/spaces/components/reader/ReaderHeader.tsx'),
      'utf8',
    );
    expect(header).toContain('Leave the reader');
  });
});
