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
