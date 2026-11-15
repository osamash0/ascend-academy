import type { Slide } from '@/types/domain';
import source from './normalization-deck.json';

/**
 * The Normalization Material, page by page — `slides` rows as
 * `GET /api/v1/localized-content/lectures/{id}` returns them.
 *
 * Built from `normalization-deck.json`, the same source that renders
 * `public/v4-mock/normalization.pdf` (scripts/v4-mock/build_normalization_deck.py),
 * so the page and its text agree by construction. The deck is written for
 * Learnstation: twelve pages, the bullets the parser would list, a table where
 * the page has one, and a display formula on the definitions of FD and BCNF,
 * which gives the formula mark something to open. The running footer is left
 * out, as the parser leaves it out.
 *
 * `summary` is null throughout: the reading face renders `content_text`.
 * Whether the AI narrative should ever appear in it is an open question the
 * design has not answered, and a fixture should not answer it by accident.
 */

export interface DeckPage {
  page: number;
  conceptId: string;
  title: string;
  bullets: string[];
  table?: { columns: string[]; rows: string[][] };
  formula?: { tex: string; plain: string };
}

export const normalizationDeck: DeckPage[] = source.pages;

const tableMarkdown = ({ columns, rows }: NonNullable<DeckPage['table']>) =>
  [columns, columns.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');

const contentText = (p: DeckPage) =>
  [
    p.bullets.map((b) => `- ${b}`).join('\n'),
    p.table && tableMarkdown(p.table),
    p.formula && `$$\n${p.formula.tex}\n$$`,
  ]
    .filter(Boolean)
    .join('\n\n');

export const normalizationSlides: Slide[] = normalizationDeck.map((p) => ({
  id: `sl-l-s-dbs-4-${p.page}`,
  slide_number: p.page,
  title: p.title,
  content_text: contentText(p),
  summary: null,
}));
