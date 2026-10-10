import type { LectureConcept, Slide as SlideRow } from '@/types/domain';
import type { Concept, MaterialPage } from '../../types';

/**
 * The shared spine.
 *
 * Both faces of a Lesson — the Material's pages and the parsed text — are
 * built on one skeleton, and the skeleton is what the backend already has:
 * a page is a `slides` row, a Concept is a set of pages
 * (`concept_lectures.slide_indices`), and a position in the Lesson is
 * `{conceptId, page}`. The reader holds one such anchor. Switching faces never
 * changes it, which is the whole reason the other face can be positioned
 * before it is ever shown.
 *
 * Everything in this file is a pure function of the two wire shapes. No
 * React, no DOM, no fixture — so it is the same code whether the slides came
 * from `mocks/content.ts` or from the bundle endpoint.
 */

/** Where you are: an idea, and the page of the file it is being read from. */
export interface Anchor {
  conceptId: string;
  page: number;
}

/** One page of the Material, set as text. */
export interface ReadingBlock {
  /** DOM id — `blockId(page)` — so a jump can find it. */
  id: string;
  /** 1-based, as printed on the page. */
  page: number;
  conceptId: string;
  title: string | null;
  markdown: string;
}

/** One Concept's pages, in page order. What the reading face draws an `h2` for. */
export interface ReadingSection {
  conceptId: string;
  name: string;
  firstPage: number;
  blocks: ReadingBlock[];
}

/**
 * The Concept a page belongs to, or null when the graph tagged none.
 *
 * `slide_indices` count from 0; `slide_number` counts from 1. This is the one
 * place that difference is spelled, so it cannot be spelled two ways.
 */
export function conceptOfPage(page: number, concepts: LectureConcept[]): LectureConcept | null {
  const idx = page - 1;
  return concepts.find((c) => c.slide_indices.includes(idx)) ?? null;
}

/**
 * The pages, grouped under the Concept they explain, in the order the file
 * explains them.
 *
 * A page the graph did not tag inherits the Concept of the page before it —
 * the closure-algorithm pages sit under Functional dependency because that is
 * the section of the deck they are in. Pages before the first tagged one
 * (a title, an agenda) go under the first Concept rather than under a heading
 * that names nothing. Nothing is dropped: every page of the file is somewhere
 * in the text, because a face that hid pages would not be a face of the same
 * object.
 */
export function sectionsFromRows(rows: SlideRow[], concepts: LectureConcept[]): ReadingSection[] {
  const ordered = [...rows].sort((a, b) => a.slide_number - b.slide_number);
  if (ordered.length === 0) return [];

  const firstTagged =
    ordered.map((s) => conceptOfPage(s.slide_number, concepts)).find((c) => c !== null) ??
    concepts[0] ??
    null;

  const byConcept = new Map<string, ReadingSection>();
  let current: LectureConcept | null = firstTagged;
  for (const s of ordered) {
    const tagged = conceptOfPage(s.slide_number, concepts);
    if (tagged) current = tagged;
    if (!current) continue; // a Lesson with no Concepts at all has no sections
    const block: ReadingBlock = {
      id: blockId(s.slide_number),
      page: s.slide_number,
      conceptId: current.concept_id,
      title: s.title,
      markdown: s.content_text ?? '',
    };
    const section = byConcept.get(current.concept_id);
    if (section) section.blocks.push(block);
    else
      byConcept.set(current.concept_id, {
        conceptId: current.concept_id,
        name: current.name,
        firstPage: s.slide_number,
        blocks: [block],
      });
  }
  return [...byConcept.values()].sort((a, b) => a.firstPage - b.firstPage);
}

/**
 * The Concepts as the spine draws them: in reading order, carrying whatever
 * progress the Lesson already knows. A Concept the Lesson has never heard of
 * is `untouched` — a readout can say "not yet", it cannot invent "cleared".
 */
export function spineConcepts(sections: ReadingSection[], known: Concept[]): Concept[] {
  return sections.map((s) => ({
    id: s.conceptId,
    name: s.name,
    progress: known.find((k) => k.id === s.conceptId)?.progress ?? 'untouched',
  }));
}

/** The anchor for a page: the page, and the section it is read under. */
export function anchorForPage(page: number, sections: ReadingSection[]): Anchor | null {
  for (const s of sections) if (s.blocks.some((b) => b.page === page)) return { conceptId: s.conceptId, page };
  return null;
}

/** The first page of a Concept — where a citation or a spine tick lands. */
export function firstPageOf(conceptId: string, sections: ReadingSection[]): number | null {
  return sections.find((s) => s.conceptId === conceptId)?.firstPage ?? null;
}

/**
 * The pages in the shape `SourceView` already takes.
 *
 * `bullets` is empty because the sheet it draws is the rendered page, not the
 * text card — the text card was what a Material looked like before there was
 * a file to show. The pager and the sync line under it are what is reused.
 */
export function materialPagesFrom(sections: ReadingSection[]): MaterialPage[] {
  return sections
    .flatMap((s) => s.blocks.map((b) => ({ page: b.page, conceptId: s.conceptId, title: b.title ?? '', bullets: [] })))
    .sort((a, b) => a.page - b.page);
}

/** The DOM id of a page's block, so a jump can find it. */
export function blockId(page: number): string {
  return `block-p${page}`;
}
