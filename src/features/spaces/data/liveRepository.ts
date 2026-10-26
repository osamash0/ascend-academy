/** Authenticated v4 transport seam for the reader. Presentation never imports the HTTP client.
 * Loading this module does not initialize auth or make requests in demo mode.
 * The repository never substitutes fixtures for errors or missing live rows.
 */
import i18n from '@/i18n';
import type { ExplainAnswer } from '../components/reader/iui/spec';
import type { Note, Person } from '../types';
import type { PracticeQuestion } from '../mocks/practice';
import type { Upload, World } from './world';
import type { AskAnswer } from './assistant';

/** A course, read as the reader's Space: its lectures in order. */
/** An upload as the early reader sees it (GET /v4/uploads/:run/reading). */
export interface EarlyReading {
  pdfUrl: string | null;
  pages: number;
  pagesRead: number;
  stage: 'developing' | 'ready' | 'failed';
  lessonId: string | null;
}

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

/** An exam rehearsal: questions written from the course's own slides. */
export interface Rehearsal {
  title: string;
  /** lecture id → title, for the lectures the questions come from. */
  lectures: Record<string, string>;
  questions: RehearsalQuestion[];
}

interface RehearsalBase {
  id: number;
  lecture_id: string;
  page: number;
  idea: string;
  prompt: string;
  why: string;
}

type RFD = { lhs: string[]; rhs: string[] };

export type RehearsalQuestion =
  | (RehearsalBase & { kind: 'choice'; options: { text: string; correct?: boolean }[] })
  | (RehearsalBase & { kind: 'order'; items: string[]; shuffle: number[] })
  | (RehearsalBase & { kind: 'fdHolds'; columns: string[]; rows: string[][]; candidates: RFD[] })
  | (RehearsalBase & { kind: 'closure'; attrs: string[]; fds: RFD[]; start: string[] })
  | (RehearsalBase & { kind: 'bcnf'; relation: string; attrs: string[]; fds: RFD[] });

/** One idea of the course building on an earlier one; ends are (lecture, first page). */
export interface ReaderLink {
  from: { lecture_id: string; first_page: number };
  to: { lecture_id: string; first_page: number };
  why: string;
}

/** One or two questions on a single idea, asked as the reader finishes it. */
export interface Checkpoint {
  idea: string;
  first: number;
  last: number;
  questions: RehearsalQuestion[];
  cached: boolean;
}

/** An explanation in the student's own words, read against the idea's key points. */
export interface TeachBack {
  idea: string;
  first: number;
  last: number;
  verdict: 'solid' | 'partial' | 'off';
  points: { point: string; page: number; covered: boolean }[];
  /** `quote` is exactly as the student wrote it, so it can be underlined in their text. */
  wrong: { quote: string; correction: string; page: number }[];
  next: string;
}

/** One answered question, as history keeps it: what it tested, and whether it was right. */
export interface RehearsalResult {
  lecture_id: string;
  page: number;
  idea: string;
  kind: string;
  correct: boolean;
}

/** An idea whose latest answer was wrong. */
export interface WeakIdea {
  lecture_id: string;
  lecture_title: string;
  idea: string;
  page: number;
  missed: number;
  seen: number;
}

export interface RehearsalHistory {
  attempts: { id: string; title: string; score: number; total: number; created_at: string }[];
  weak: WeakIdea[];
  steady_count: number;
  /** Every tested idea's latest result, by the page it was asked about. */
  marks?: { lecture_id: string; page: number; correct: boolean; at?: string }[];
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
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
  /** A multipart POST (a file). Optional: only bringing files in needs it. */
  upload?<T>(path: string, form: FormData): Promise<T>;
}

/** What the background upload answers: one row per file, queued or failed at once. */
export interface LessonBatch {
  batch_id: string;
  files: { filename: string; run_id: string | null; status: string; error?: string }[];
}
/** One file of a batch as it is prepared; `status` is the parse run's. */
export interface LessonBatchRow {
  run_id: string;
  status: string;
  error: string | null;
  filename: string;
  lecture_id: string | null;
  title: string | null;
}

const root = '/api/v1/v4';
const idPath = (id: string) => encodeURIComponent(id);

export function createLiveRepository(http: V4Transport) {
  return {
    /* The signed-in person (`/v4/me`, FEATURE_V4). */
    me: () => http.get<Person>(`${root}/me`),
    /* Everything the core loop renders: the viewer, their Spaces and Lessons (`/v4/world`). */
    world: () => http.get<World>(`${root}/world`),
    /* Bring a file in: a private lecture in your personal Space (FEATURE_STUDENT_UPLOADS). */
    bringIn: (file: File) => {
      if (!http.upload) return Promise.reject(new Error('This transport cannot send files.'));
      const form = new FormData();
      form.append('file', file);
      return http.upload<{ status: 'queued' | 'duplicate'; run_id?: string; lecture_id?: string }>(
        `${root}/uploads`,
        form,
      );
    },
    /* Your uploads, as the shelf shows them — polled while one develops. */
    uploads: () => http.get<{ uploads: Upload[] }>(`${root}/uploads`),
    /* Remove an upload for good: its Lesson (lecture id) or a failed run (run id). */
    readingFor: (runId: string) => http.get<EarlyReading>(`${root}/uploads/${idPath(runId)}/reading`),
    removeUpload: (id: string) => http.delete<{ removed: true }>(`${root}/uploads/${idPath(id)}`),
    /* Home's ask bar: the grounded course tutor. */
    ask: (question: string) => http.post<AskAnswer>(`${root}/ask`, { question }),
    /* Accept or decline a friend request addressed to you. */
    answerFriendRequest: (personId: string, verdict: 'accept' | 'decline') =>
      http.post<{ ok: true }>(`${root}/friends/${idPath(personId)}/${verdict}`, {}),
    /* Private notes. The server answers with the stored note (real id, kept names). */
    addNote: (body: string, lessonId: string | null) =>
      http.post<Note>(`${root}/notes`, lessonId ? { body, lesson_id: lessonId } : { body }),
    updateNote: (id: string, body: string) => http.patch<Note>(`${root}/notes/${idPath(id)}`, { body }),
    deleteNote: (id: string) => http.delete<{ deleted: true }>(`${root}/notes/${idPath(id)}`),
    /* Mark every notification read. */
    markNotificationsRead: () => http.post<{ marked: number }>(`${root}/notifications/read-all`, {}),
    /* Make a Space on the stage: a course you own, empty and private to start (LS-050). */
    createSpace: (name: string) => http.post<{ id: string }>(`${root}/spaces`, { name }),
    /* Publish your Space, or make it private again (owners only, LS-072). */
    setSpacePublished: (id: string, published: boolean) =>
      http.patch<{ published: boolean }>(`${root}/spaces/${idPath(id)}`, { published }),
    /*
     * Add Lessons to your Space on the stage (LS-072): the course manager's own
     * background upload, aimed at this Space — the server checks you own it.
     * It answers at once; poll `lessonBatch` while the files are prepared.
     */
    addLessons: (spaceId: string, files: File[]) => {
      if (!http.upload) return Promise.reject(new Error('This transport cannot send files.'));
      const form = new FormData();
      for (const f of files) form.append('files', f);
      form.append('course_id', spaceId);
      return http.upload<LessonBatch>('/api/upload/batch', form);
    },
    lessonBatch: (batchId: string) =>
      http.get<{ batch_id: string; lectures: LessonBatchRow[] }>(`/api/upload/batches/${idPath(batchId)}`),
    /* Join an open Space (enrol in its course). Idempotent. */
    joinSpace: (id: string) => http.post<{ joined: true }>(`${root}/spaces/${idPath(id)}/join`, {}),
    /* The reader, on real courses and lectures (`/v4/reader`, FEATURE_V4_READER). */
    readerCourse: (id: string) => http.get<ReaderCourse>(`${root}/reader/courses/${idPath(id)}`),
    readerLecture: (id: string) => http.get<ReaderLecture>(`${root}/reader/lectures/${idPath(id)}`),
    /** The page just left, and how long it was open. Writes progress, visits, streak. */
    recordReading: (id: string, page: number, seconds: number) =>
      http.post<{ pagesRead: number; percentComplete: number }>(`${root}/reader/lectures/${idPath(id)}/progress`, {
        page,
        seconds,
      }),
    /** The lecture's real quiz questions, as PracticeQuestions. */
    practice: (id: string) => http.get<{ questions: PracticeQuestion[] }>(`${root}/reader/lectures/${idPath(id)}/practice`),
    /** Graded on the server; logs a quiz_attempt and grants XP once per question. */
    answerPractice: (id: string, questionId: string, answer: string) =>
      http.post<{ correct: boolean; correctAnswer: string; explanation: string; xp: number }>(
        `${root}/reader/lectures/${idPath(id)}/practice/answer`,
        { question_id: questionId, answer },
      ),
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
    composeRehearsal: (courseId: string, body: { lecture_ids: string[]; count: number; weak_ideas: string[] }) =>
      http.post<Rehearsal>(`${root}/reader/courses/${idPath(courseId)}/rehearsal`, body),
    saveRehearsal: (courseId: string, body: { title: string; lecture_ids: string[]; results: RehearsalResult[] }) =>
      http.post<{ id: string; created_at: string }>(`${root}/reader/courses/${idPath(courseId)}/rehearsals`, body),
    checkpoint: (lectureId: string, body: { first: number; last: number; idea: string }) =>
      http.post<Checkpoint>(`${root}/reader/lectures/${idPath(lectureId)}/checkpoint`, body),
    teachBack: (lectureId: string, body: { first: number; last: number; idea: string; explanation: string }) =>
      http.post<TeachBack>(`${root}/reader/lectures/${idPath(lectureId)}/teach-back`, body),
    courseLinks: (courseId: string) =>
      http.get<{ links: ReaderLink[]; cached: boolean; complete: boolean }>(`${root}/reader/courses/${idPath(courseId)}/links`),
    rehearsalHistory: (courseId: string) => http.get<RehearsalHistory>(`${root}/reader/courses/${idPath(courseId)}/rehearsals`),
    askPage: (id: string, page: number, question: string, thread: { question: string; title: string }[]) =>
      http.post<ExplainAnswer & { cached: boolean }>(`${root}/reader/lectures/${idPath(id)}/pages/${page}/ask`, {
        question,
        thread,
      }),
    /* Your complete record (GDPR Art. 20): every table the server exports, not what the browser can read. */
    exportAccount: () => http.get<unknown>('/api/auth/export-data'),
    /* Server-side erasure of the account and everything in it. No browser fallback: a failure is a failure. */
    deleteAccount: () => http.post<{ files?: string }>('/api/auth/delete-account', {}),
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
  return createLiveRepository(
    withLanguage({
      ...apiClient,
      upload: <T,>(path: string, form: FormData) => apiClient.upload(path, form).then((r) => r.json() as Promise<T>),
    }),
  );
}

/*
 * Every request says which language the app is showing. The server would
 * otherwise read the profile — and a reader who just switched to Deutsch would
 * be answered in the old language until the profile write landed.
 */
function withLanguage(http: V4Transport): V4Transport {
  const tag = (path: string) => `${path}${path.includes('?') ? '&' : '?'}lang=${(i18n.language || 'en').split('-')[0]}`;
  return {
    get: <T>(path: string) => http.get<T>(tag(path)),
    post: <T>(path: string, body: unknown) => http.post<T>(tag(path), body),
    patch: <T>(path: string, body: unknown) => http.patch<T>(tag(path), body),
    delete: <T>(path: string) => http.delete<T>(tag(path)),
    upload: http.upload ? <T>(path: string, form: FormData) => http.upload!<T>(tag(path), form) : undefined,
  };
}
