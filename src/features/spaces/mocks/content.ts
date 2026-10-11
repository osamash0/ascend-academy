import type { LectureConcept, LocalizedLectureBundle } from '@/types/domain';
import { normalizationSlides } from './content.normalization';

/**
 * What a Lesson is made of, in the shapes the backend already serves.
 *
 * Two endpoints feed a reading surface today, and this module returns their
 * responses verbatim in type:
 *
 *   • `GET /api/v1/localized-content/lectures/{id}` → `LocalizedLectureBundle`
 *     (the pages as `slides`, the file as `lecture.pdf_url`)
 *   • `GET /api/v1/concepts/lecture/{id}`           → `LectureConcept[]`
 *     (which pages each Concept covers, 0-based)
 *
 * plus the signed URL `lectureService.resolvePdfUrl` would mint for the file.
 * Nothing here is a shape the backend does not have. What the backend does
 * *not* have is listed at the bottom, as the endpoints wiring will need.
 *
 * Only `l-s-dbs-4` (Normalization) has content. Every other Lesson returns
 * `null`, and the screen says so — the same rule the reader has always had
 * about Lessons whose text is not written.
 */

export interface LessonContent {
  bundle: LocalizedLectureBundle;
  concepts: LectureConcept[];
  /** What `resolvePdfUrl(bundle.lecture.pdf_url)` returns. Null = no file. */
  pdfUrl: string | null;
}

/*
 * The deck's own order is FD → closure → BCNF → normal forms, so BCNF comes
 * before 1NF here and the reading face follows the pages, not the Lesson's
 * concept list. `slide_indices` are 0-based, as the concept graph writes
 * them; the closure-algorithm pages (31–39) and the automation pages (61–65)
 * belong to no Concept, which is realistic — the graph tags what it can.
 */
const range = (fromPage: number, toPage: number) =>
  Array.from({ length: toPage - fromPage + 1 }, (_, i) => fromPage - 1 + i);

const normalizationConcepts: LectureConcept[] = [
  { concept_id: 'c-l-s-dbs-4-1', name: 'Functional dependency', weight: 0.34, slide_indices: range(4, 29) },
  {
    concept_id: 'c-l-s-dbs-4-5',
    name: 'BCNF',
    weight: 0.3,
    slide_indices: [...range(41, 60), ...range(74, 75)],
  },
  { concept_id: 'c-l-s-dbs-4-2', name: '1NF', weight: 0.1, slide_indices: range(67, 69) },
  { concept_id: 'c-l-s-dbs-4-3', name: '2NF', weight: 0.12, slide_indices: range(70, 71) },
  { concept_id: 'c-l-s-dbs-4-4', name: '3NF', weight: 0.14, slide_indices: range(72, 73) },
];

const CONTENT: Record<string, LessonContent> = {
  'l-s-dbs-4': {
    bundle: {
      locale: 'en',
      requestedLocale: 'en',
      isOriginalLanguage: false,
      lecture: {
        id: 'l-s-dbs-4',
        title: 'Normalization',
        description: null,
        total_slides: normalizationSlides.length,
        created_at: '2026-02-10T09:00:00Z',
        // Path-only, the way the column is stored; the signed URL is below.
        pdf_url: 'materials/l-s-dbs-4/normalization.pdf',
        poster_url: null,
        source_language: 'en',
        content_revision: 1,
      },
      slides: normalizationSlides,
      questions: [],
    },
    concepts: normalizationConcepts,
    pdfUrl: '/v4-mock/normalization.pdf',
  },
};

export const lessonContent = (lessonId: string): LessonContent | null =>
  CONTENT[lessonId] ?? null;

/*
 * NEEDS-BACKEND — what the reading surface uses that no endpoint returns:
 *
 *   1. A `grounded` flag and Concept-level citations on the Lesson tutor.
 *      `POST /api/v1/ai/chat` returns `{reply, citations: [{slide_index}]}`;
 *      the panel needs `{conceptId | materialPage}` and, where the Space has
 *      grounding on, whether the answer was grounded. `materialPage` is
 *      `slide_index + 1`; `conceptId` needs the `slide_indices` map above,
 *      which the client can do until the server does.
 *   2. Private, Lesson-anchored notes. `mocks/notes.ts` has no table behind it.
 *   3. Concept progress (`untouched | discovered | cleared`) per Learner.
 *      `concept_mastery` exists as a table; nothing reads it for this.
 *   4. The Lesson's accent colour. Sampled client-side from the rendered page
 *      today (`sampleAccent`); belongs on the Lesson at ingest.
 */
