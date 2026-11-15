import { describe, expect, it } from 'vitest';
import type { LectureConcept, Slide } from '@/types/domain';
import {
  anchorForPage,
  conceptOfPage,
  firstPageOf,
  materialPagesFrom,
  sectionsFromRows,
  spineConcepts,
} from '../../components/reader/anchors';
import { lessonContent } from '../content';
import { dbsLessons } from '../lessons';
import { tutorScripts } from '../tutor';

/**
 * The shared spine, against the one Lesson that has content.
 *
 * These are the guards that let two faces claim to be one object: every page
 * of the file is in the text, every Concept the spine draws is a Concept the
 * Lesson has, and every place a citation can point is a place that exists.
 */

const content = lessonContent('l-s-dbs-4')!;
const lesson = dbsLessons.find((l) => l.id === 'l-s-dbs-4')!;
const sections = sectionsFromRows(content.bundle.slides, content.concepts);

describe('the content fixture is the endpoints’ shape', () => {
  it('has a page for every slide the file has, numbered from 1 without gaps', () => {
    const numbers = content.bundle.slides.map((s) => s.slide_number).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(content.bundle.lecture.total_slides).toBe(numbers.length);
  });

  it('gives every page text', () => {
    for (const s of content.bundle.slides) expect(s.content_text?.trim(), `page ${s.slide_number}`).toBeTruthy();
  });

  it('tags only pages that exist, 0-based', () => {
    const max = content.bundle.slides.length - 1;
    for (const c of content.concepts)
      for (const i of c.slide_indices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i, `${c.name} tags a page past the end`).toBeLessThanOrEqual(max);
      }
  });

  it('names only Concepts the Lesson has', () => {
    const ids = lesson.concepts.map((c) => c.id);
    for (const c of content.concepts) expect(ids).toContain(c.concept_id);
  });
});

/*
 * The deck tags every page, in the Lesson's own order. What a real file also
 * brings — a Concept explained before one the Lesson lists first, untagged
 * pages, a Concept split around another — is built here, on eight pages.
 */
const page = (n: number): Slide => ({ id: `s${n}`, slide_number: n, title: `Page ${n}`, content_text: 'text', summary: null });
const filePages = [1, 2, 3, 4, 5, 6, 7, 8].map(page);
const tags: LectureConcept[] = [
  { concept_id: 'c', name: 'C', weight: 0.2, slide_indices: [5, 6] }, // pages 6–7
  { concept_id: 'b', name: 'B', weight: 0.3, slide_indices: [3, 7] }, // pages 4 and 8, around C
  { concept_id: 'a', name: 'A', weight: 0.5, slide_indices: [1] }, // page 2; pages 1, 3 and 5 are untagged
];
const fileSections = sectionsFromRows(filePages, tags);

describe('sections are the file in reading order', () => {
  it('orders Concepts by their first page, not by the Lesson’s list', () => {
    expect(fileSections.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    expect(sections.map((s) => s.name)).toEqual(['Functional dependency', '1NF', '2NF', '3NF', 'BCNF']);
  });

  it('loses no page: every slide is in exactly one section', () => {
    const pages = sections.flatMap((s) => s.blocks.map((b) => b.page)).sort((a, b) => a - b);
    expect(pages).toEqual(content.bundle.slides.map((s) => s.slide_number).sort((a, b) => a - b));
    const filed = fileSections.flatMap((s) => s.blocks.map((b) => b.page)).sort((a, b) => a - b);
    expect(filed).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('files an untagged page under the Concept before it', () => {
    expect(conceptOfPage(3, tags)).toBeNull();
    expect(anchorForPage(3, fileSections)?.conceptId).toBe('a');
    expect(anchorForPage(5, fileSections)?.conceptId).toBe('b');
  });

  it('files the title and agenda under the first Concept rather than under nothing', () => {
    expect(anchorForPage(1, fileSections)?.conceptId).toBe('a');
    expect(anchorForPage(1, sections)?.conceptId).toBe('c-l-s-dbs-4-1');
  });

  it('keeps a split Concept in one section, in page order', () => {
    const b = fileSections.find((s) => s.name === 'B')!;
    const pages = b.blocks.map((x) => x.page);
    expect(pages).toContain(4);
    expect(pages).toContain(8);
    expect([...pages].sort((x, y) => x - y)).toEqual(pages);
  });
});

describe('what the spine and the pager are handed', () => {
  it('carries the Lesson’s progress onto the spine and invents none', () => {
    const spine = spineConcepts(sections, lesson.concepts);
    expect(spine.map((c) => c.id)).toEqual(sections.map((s) => s.conceptId));
    for (const c of spine) {
      const known = lesson.concepts.find((k) => k.id === c.id);
      expect(c.progress).toBe(known?.progress ?? 'untouched');
    }
  });

  it('gives SourceView contiguous pages that each name their Concept', () => {
    const pages = materialPagesFrom(sections);
    expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
    for (const p of pages) expect(sections.some((s) => s.conceptId === p.conceptId)).toBe(true);
  });

  it('lands a Concept on its first page', () => {
    expect(firstPageOf('c-l-s-dbs-4-2', sections)).toBe(4);
    expect(firstPageOf('c-nope', sections)).toBeNull();
  });
});

describe('every citation the tutor can make lands somewhere', () => {
  it('points at a real page or a real Concept of this content', () => {
    const pages = materialPagesFrom(sections);
    for (const ex of tutorScripts['l-s-dbs-4'])
      for (const c of ex.reply.citations) {
        if (c.conceptId) expect(sections.some((s) => s.conceptId === c.conceptId), c.label).toBe(true);
        if (c.materialPage) expect(pages.some((p) => p.page === c.materialPage), c.label).toBe(true);
      }
  });
});

describe('a Lesson with no content', () => {
  it('returns null rather than an empty bundle', () => {
    expect(lessonContent('l-s-dbs-3')).toBeNull();
  });

  it('yields no sections from no slides', () => {
    expect(sectionsFromRows([], content.concepts)).toEqual([]);
  });
});
