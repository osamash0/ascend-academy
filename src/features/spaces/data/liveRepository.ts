/** Authenticated v4 transport seam for the reader. Presentation never imports the HTTP client.
 * Loading this module does not initialize auth or make requests in demo mode.
 * The repository never substitutes fixtures for errors or missing live rows.
 */
import type { ExplainAnswer } from '../components/reader/iui/spec';

/** A course, read as the reader's Space: its lectures in order. */
export interface ReaderCourse {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  author: string | null;
  lectures: { id: string; title: string; total_slides: number; order: number }[];
}

/** The course as a journey: each lecture with its poster and, where known, its ideas. */
export interface ReaderCourseMap extends Omit<ReaderCourse, 'lectures'> {
  lectures: (ReaderCourse['lectures'][number] & {
    poster: string | null;
    /** Null when the lecture's ideas have not been grouped yet. */
    ideas: { name: string; first_page: number }[] | null;
  })[];
}

/** A page where a topic is taught. `snippet` marks the matched words «like this». */
export interface ReaderFind {
  lecture_id: string;
  lecture_title: string;
  page: number;
  title: string | null;
  snippet: string;
}

/** One lecture's concept rows, in the endpoint's own shape. */
export interface ReaderConcept {
  concept_id: string;
  name: string;
  weight: number;
  slide_indices: number[];
}

/** A lecture, read as the reader's Lesson. `bundle` is the localized-content shape, snake_case. */
export interface ReaderLecture {
  bundle: {
    locale: 'en' | 'de';
    requested_locale: 'en' | 'de';
    is_original_language: boolean;
    lecture: {
      id: string;
      title: string;
      description: string | null;
      total_slides: number;
      created_at: string;
      pdf_url: string | null;
      poster_url: string | null;
      course_id: string | null;
      is_archived: boolean | null;
      source_language: 'en' | 'de';
      content_revision: number;
    };
    slides: { id: string; slide_number: number; title: string | null; content_text: string | null; summary: string | null }[];
  };
  concepts: ReaderConcept[];
  pdf_signed_url: string | null;
}

export interface V4Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

const root = '/api/v1/v4';
const idPath = (id: string) => encodeURIComponent(id);

export function createLiveRepository(http: V4Transport) {
  return {
    /* The reader, on real courses and lectures (`/v4/reader`, FEATURE_V4_READER). */
    readerCourse: (id: string) => http.get<ReaderCourse>(`${root}/reader/courses/${idPath(id)}`),
    readerLecture: (id: string) => http.get<ReaderLecture>(`${root}/reader/lectures/${idPath(id)}`),
    readerIdeas: (id: string) => http.get<{ concepts: ReaderConcept[] }>(`${root}/reader/lectures/${idPath(id)}/ideas`),
    explainPage: (id: string, page: number) =>
      http.post<ExplainAnswer & { cached: boolean }>(`${root}/reader/lectures/${idPath(id)}/pages/${page}/explain`, {}),
    courseMap: (id: string) => http.get<ReaderCourseMap>(`${root}/reader/courses/${idPath(id)}/map`),
    findInCourse: (id: string, q: string) =>
      http.get<{ results: ReaderFind[] }>(`${root}/reader/courses/${idPath(id)}/find?q=${encodeURIComponent(q)}`),
    /** Strict, other lectures only: where an idea is taught again. */
    relatedInCourse: (id: string, q: string, excludeLecture: string) =>
      http.get<{ results: ReaderFind[] }>(
        `${root}/reader/courses/${idPath(id)}/find?q=${encodeURIComponent(q)}&exclude_lecture=${idPath(excludeLecture)}&strict=true&limit=4`,
      ),
    askPage: (id: string, page: number, question: string, thread: { question: string; title: string }[]) =>
      http.post<ExplainAnswer & { cached: boolean }>(`${root}/reader/lectures/${idPath(id)}/pages/${page}/ask`, {
        question,
        thread,
      }),
  };
}

export type LiveRepository = ReturnType<typeof createLiveRepository>;

/** Explicit opt-in; a typo must not silently select a different data source. */
export function dataMode(value: string | undefined): 'demo' | 'live' {
  if (!value || value === 'demo') return 'demo';
  if (value === 'live') return 'live';
  throw new Error('VITE_V4_DATA_MODE must be demo or live.');
}

export async function loadLiveRepository(): Promise<LiveRepository> {
  if (dataMode(import.meta.env.VITE_V4_DATA_MODE) !== 'live') {
    throw new Error('Live v4 data is not enabled.');
  }
  const { apiClient } = await import('@/lib/apiClient');
  return createLiveRepository(apiClient);
}
