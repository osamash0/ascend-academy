import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { LectureConcept, LocalizedLectureBundle } from '@/types/domain';
import type { Lesson, LoadState, Space } from '../types';
import type { ExplainAnswer } from '../components/reader/iui/spec';
import { composeFromText, explainFor } from '../mocks/explain';
import {
  dataMode,
  loadLiveRepository,
  type Checkpoint,
  type ReaderLink,
  type TeachBack,
  type ReaderConcept,
  type ReaderCourse,
  type ReaderCourseMap,
  type ReaderFind,
  type ReaderLecture,
  type Rehearsal,
  type RehearsalHistory,
  type RehearsalResult,
} from './liveRepository';
import { useLesson, useLessonContent, type LessonContentResult, type LessonResult } from './useSpaces';

/**
 * The reader's data, demo or real.
 *
 * Demo ids (`s-dbs`, `l-s-dbs-4`) read the mocks, as before. Real ids — a
 * course's and a lecture's UUIDs — read the backend when the build is in
 * live mode (`VITE_V4_DATA_MODE=live`): the course is the Space, the lecture
 * the Lesson, its slides and signed PDF the content. Everything goes through
 * `liveRepository`; nothing here touches HTTP.
 *
 * A course or lecture fetched once is shared between the Lesson overview and
 * the reader, so moving between them costs nothing. Errors are errors — a
 * live read never falls back to demo data.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether this pair of ids is read from the backend. */
export function isLive(...ids: (string | undefined)[]): boolean {
  let mode: 'demo' | 'live' = 'demo';
  try {
    mode = dataMode(import.meta.env.VITE_V4_DATA_MODE);
  } catch {
    mode = 'demo';
  }
  return mode === 'live' && ids.every((id) => !!id && UUID.test(id));
}

/* ─── shared requests ─────────────────────────────────────────────────── */

const courses = new Map<string, Promise<ReaderCourse>>();
const lectures = new Map<string, Promise<ReaderLecture>>();
const ideas = new Map<string, Promise<ReaderConcept[]>>();
const answers = new Map<string, Promise<ExplainAnswer>>();

const once = <T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
  let p = map.get(key);
  if (!p) {
    p = make();
    map.set(key, p);
    /* A failure is not remembered: the next visit tries again. */
    p.catch(() => map.delete(key));
  }
  return p;
};

const getCourse = (id: string) => once(courses, id, async () => (await loadLiveRepository()).readerCourse(id));
const getLecture = (id: string) => once(lectures, id, async () => (await loadLiveRepository()).readerLecture(id));
const getIdeas = (id: string) =>
  once(ideas, id, async () => (await (await loadLiveRepository()).readerIdeas(id)).concepts);

/** An HTTP status from the transport's error, when it carries one. */
const statusOf = (e: unknown) => (typeof e === 'object' && e && 'status' in e ? Number((e as { status: unknown }).status) : 0);

/* ─── adapters ────────────────────────────────────────────────────────── */

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function spaceFromCourse(c: ReaderCourse): Space {
  const owner = { id: `course-${c.id}`, name: c.author ?? 'Course team', avatarUrl: null };
  return {
    id: c.id,
    name: c.title,
    shortCode: initials(c.title) || 'C',
    description: c.description,
    owner,
    universe: null,
    classification: { domain: 'Course', subject: null },
    mode: 'guided',
    visibility: 'invite',
    state: 'active',
    groundingEnabled: true,
    strictMode: false,
    memberCount: 0,
    starCount: 0,
    starredByViewer: false,
    viewerRole: 'member',
  } as Space;
}

function lessonFrom(c: ReaderCourse, l: ReaderCourse['lectures'][number], concepts: ReaderConcept[] = []): Lesson {
  const owner = { id: `course-${c.id}`, name: c.author ?? 'Course team', avatarUrl: null };
  return {
    id: l.id,
    spaceId: c.id,
    title: l.title,
    order: l.order,
    state: 'published',
    origin: 'official',
    author: owner,
    grounding: 'grounded',
    // Progress is not read yet: say nothing rather than invent some.
    progress: 'not-started',
    percentComplete: 0,
    concepts: concepts.map((k) => ({ id: k.concept_id, name: k.name, progress: 'untouched' })),
    material: {
      id: `material-${l.id}`,
      filename: l.title,
      sizeBytes: 0,
      uploadedBy: owner,
      uploadedAt: '',
      sourceRemoved: false,
    },
    contributionCount: 0,
    practiceCount: 0,
  };
}

function bundleFrom(r: ReaderLecture): LocalizedLectureBundle {
  const b = r.bundle;
  return {
    locale: b.locale,
    requestedLocale: b.requested_locale,
    isOriginalLanguage: b.is_original_language,
    lecture: {
      ...b.lecture,
      is_archived: b.lecture.is_archived ?? false,
    },
    slides: b.slides.map((s) => ({ ...s, title: s.title ?? null })),
    questions: [],
  } as LocalizedLectureBundle;
}

/* ─── hooks ───────────────────────────────────────────────────────────── */

/** The Lesson and its Space, demo or real — `useLesson`'s shape either way. */
/**
 * The language the app is showing. Requests carry it (see `withLanguage`), so
 * anything a hook fetched in one language is fetched again after a switch.
 */
function useLang(): string {
  const { i18n: inst } = useTranslation();
  return (inst.language || 'en').split('-')[0];
}

export function useReaderLesson(spaceId: string | undefined, lessonId: string | undefined): LessonResult {
  const live = isLive(spaceId, lessonId);
  const demo = useLesson(live ? undefined : spaceId, live ? undefined : lessonId);
  const [state, setState] = useState<LessonResult>({ state: 'loading', space: null, lesson: null, prev: null, next: null });

  useEffect(() => {
    if (!live || !spaceId || !lessonId) return;
    let alive = true;
    setState({ state: 'loading', space: null, lesson: null, prev: null, next: null });
    getCourse(spaceId)
      .then((c) => {
        if (!alive) return;
        const i = c.lectures.findIndex((l) => l.id === lessonId);
        if (i < 0) return setState({ state: 'ready', space: spaceFromCourse(c), lesson: null, prev: null, next: null });
        const at = (concepts: ReaderConcept[]): LessonResult => ({
          state: 'ready',
          space: spaceFromCourse(c),
          lesson: lessonFrom(c, c.lectures[i], concepts),
          prev: i > 0 ? lessonFrom(c, c.lectures[i - 1]) : null,
          next: i + 1 < c.lectures.length ? lessonFrom(c, c.lectures[i + 1]) : null,
        });
        setState(at([]));
        /* The ideas follow when they are ready — the page does not wait for them. */
        getIdeas(lessonId)
          .then((concepts) => alive && concepts.length > 0 && setState(at(concepts)))
          .catch(() => undefined);
      })
      .catch((e) => {
        if (!alive) return;
        const s = statusOf(e);
        setState({ state: s === 404 || s === 403 ? 'ready' : 'error', space: null, lesson: null, prev: null, next: null });
      });
    return () => {
      alive = false;
    };
  }, [live, spaceId, lessonId]);

  return live ? state : demo;
}

/** What the Lesson is made of — `useLessonContent`'s shape, demo or real. */
export function useReaderContent(spaceId: string | undefined, lessonId: string | undefined): LessonContentResult {
  const live = isLive(spaceId, lessonId);
  const lang = useLang();
  const demo = useLessonContent(live ? undefined : lessonId);
  const [state, setState] = useState<LessonContentResult>({ state: 'loading', bundle: null, concepts: [], pdfUrl: null });

  useEffect(() => {
    if (!live || !lessonId) return;
    let alive = true;
    setState({ state: 'loading', bundle: null, concepts: [], pdfUrl: null });
    getLecture(lessonId)
      .then(async (r) => {
        if (!alive) return;
        const bundle = bundleFrom(r);
        if (bundle.slides.length === 0) return setState({ state: 'empty', bundle: null, concepts: [], pdfUrl: null });
        /*
         * The concept graph's ideas when it has some; otherwise the model's
         * grouping, which may take a moment the first time — the page shows
         * without it and the ideas arrive after.
         */
        /*
         * Until there are ideas, the deck is one section under the lecture's
         * own name, so the reader opens at once instead of waiting.
         */
        const whole: LectureConcept[] = [
          {
            concept_id: `whole-${lessonId}`,
            name: bundle.lecture.title,
            weight: 1,
            slide_indices: bundle.slides.map((s) => s.slide_number - 1),
          },
        ];
        setState({
          state: 'ready',
          bundle,
          concepts: r.concepts.length ? (r.concepts as LectureConcept[]) : whole,
          pdfUrl: r.pdf_signed_url,
        });
        if (r.concepts.length === 0) {
          const grouped = await getIdeas(lessonId).catch(() => [] as ReaderConcept[]);
          if (alive && grouped.length) setState((s) => ({ ...s, concepts: grouped as LectureConcept[] }));
        }
      })
      .catch((e) => {
        if (!alive) return;
        setState({
          state: statusOf(e) === 409 ? 'empty' : 'error',
          bundle: null,
          concepts: [],
          pdfUrl: null,
        });
      });
    return () => {
      alive = false;
    };
  }, [live, lessonId, lang]);

  return live ? state : demo;
}

export interface ExplainResult {
  state: 'loading' | 'ready' | 'error';
  answer: ExplainAnswer | null;
  /** True when the model could not answer and this is composed from the page's own text. */
  fallback: boolean;
}

/**
 * Explain for one page. Demo: the authored answer or one composed from the
 * text, at once. Live: the model's answer, generated once per page and then
 * cached on the server; if it cannot answer, the composed one, marked so.
 */
export function useExplain(
  spaceId: string | undefined,
  lessonId: string | undefined,
  page: number,
  source: { title: string; markdown: string },
  enabled = true,
): ExplainResult {
  const live = isLive(spaceId, lessonId);
  const lang = useLang();
  const [result, setResult] = useState<ExplainResult>({ state: 'loading', answer: null, fallback: false });
  const { title, markdown } = source;

  useEffect(() => {
    if (!live || !lessonId || !enabled) return;
    let alive = true;
    setResult({ state: 'loading', answer: null, fallback: false });
    once(answers, `${lessonId}:${page}:${lang}`, async () => (await loadLiveRepository()).explainPage(lessonId, page))
      .then((a) => alive && setResult({ state: 'ready', answer: a, fallback: false }))
      .catch(() => alive && setResult({ state: 'ready', answer: composeFromText(title, markdown), fallback: true }));
    return () => {
      alive = false;
    };
  }, [live, lessonId, page, title, markdown, enabled, lang]);

  if (!live) return { state: 'ready', answer: explainFor(lessonId ?? '', page, source), fallback: false };
  return result;
}

const ASK_TIMEOUT_MS = 150_000;

/** One earlier exchange, as the model is reminded of it. */
export interface AskTurn {
  question: string;
  title: string;
}

/**
 * Asking about a page, answered as an interface — live lectures only.
 * Null in demo mode, where a question goes to the tutor as before.
 */
export function useAsker(
  spaceId: string | undefined,
  lessonId: string | undefined,
): ((page: number, question: string, thread: AskTurn[]) => Promise<ExplainAnswer>) | null {
  const live = isLive(spaceId, lessonId);
  if (!live || !lessonId) return null;
  return async (page, question, thread) => {
    const repo = await loadLiveRepository();
    /* Past this, an answer is not coming: say so and offer to try again. */
    return Promise.race([
      repo.askPage(lessonId, page, question, thread),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Ask timed out')), ASK_TIMEOUT_MS)),
    ]);
  };
}

/* ─── the course ──────────────────────────────────────────────────────── */

export interface CourseResult {
  state: LoadState;
  course: ReaderCourseMap | null;
}

/**
 * A course as a journey. Lectures whose ideas were never grouped are asked
 * for one at a time, in order, and the map fills in as they arrive — the
 * first visit draws the course; every later one is instant.
 */
export function useCourse(courseId: string | undefined): CourseResult {
  const [result, setResult] = useState<CourseResult>({ state: 'loading', course: null });

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setResult({ state: 'loading', course: null });
    loadLiveRepository()
      .then((repo) => repo.courseMap(courseId))
      .then(async (course) => {
        if (!alive) return;
        setResult({ state: 'ready', course });
        for (const lec of course.lectures) {
          if (!alive) return;
          if (lec.ideas !== null) continue;
          const concepts = await getIdeas(lec.id).catch(() => [] as ReaderConcept[]);
          if (!alive) return;
          const ideas = concepts.map((c) => ({ name: c.name, first_page: Math.min(...c.slide_indices) + 1 }));
          setResult((r) =>
            r.course
              ? {
                  ...r,
                  course: {
                    ...r.course,
                    lectures: r.course.lectures.map((l) => (l.id === lec.id ? { ...l, ideas } : l)),
                  },
                }
              : r,
          );
        }
      })
      .catch((e) => {
        if (!alive) return;
        const s = statusOf(e);
        setResult({ state: s === 404 || s === 403 ? 'empty' : 'error', course: null });
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  return result;
}

/** Where a topic is taught across the course, as the reader types. */
export function useFind(courseId: string | undefined, query: string): { busy: boolean; results: ReaderFind[] } {
  const [state, setState] = useState<{ busy: boolean; results: ReaderFind[] }>({ busy: false, results: [] });
  useEffect(() => {
    const q = query.trim();
    if (!courseId || q.length < 2) {
      setState({ busy: false, results: [] });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      loadLiveRepository()
        .then((repo) => repo.findInCourse(courseId, q))
        .then((r) => alive && setState({ busy: false, results: r.results }))
        .catch(() => alive && setState({ busy: false, results: [] }));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [courseId, query]);
  return state;
}

const related = new Map<string, Promise<ReaderFind[]>>();

/**
 * Where an idea is taught again, in the course's other lectures. Strict:
 * every word of the idea must be on the page — a loose match would be a
 * wrong link, and no link is the honest answer when there is none.
 */
export function useRelated(courseId: string | undefined, lessonId: string | undefined, topic: string): ReaderFind[] {
  const live = isLive(courseId, lessonId);
  const [found, setFound] = useState<ReaderFind[]>([]);
  useEffect(() => {
    setFound([]);
    if (!live || !courseId || !lessonId || topic.trim().length < 3) return;
    let alive = true;
    once(related, `${lessonId}:${topic}`, async () =>
      (await (await loadLiveRepository()).relatedInCourse(courseId, topic, lessonId)).results,
    )
      .then((r) => alive && setFound(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [live, courseId, lessonId, topic]);
  return found;
}

const REHEARSAL_TIMEOUT_MS = 150_000;

/** Write a rehearsal from the chosen lectures — live courses only. */
export async function composeRehearsal(
  courseId: string,
  lectureIds: string[],
  count: number,
  weakIdeas: string[] = [],
): Promise<Rehearsal> {
  const repo = await loadLiveRepository();
  /* Past this the model is not coming back with it: fail visibly and offer another go. */
  return Promise.race([
    repo.composeRehearsal(courseId, { lecture_ids: lectureIds, count, weak_ideas: weakIdeas }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Rehearsal timed out')), REHEARSAL_TIMEOUT_MS)),
  ]);
}

/** Keep a finished rehearsal. The server counts the score from the results. */
/*
 * Checkpoints, one request per idea per visit: the reader asks for the next
 * one while you are still on the idea's last page, and showing it reuses the
 * same promise. The server caches it for everyone after the first.
 */
const checkpoints = new Map<string, Promise<Checkpoint>>();
export function fetchCheckpoint(lectureId: string, first: number, last: number, idea: string): Promise<Checkpoint> {
  const key = `${lectureId}:${first}-${last}:${(i18n.language || 'en').split('-')[0]}`;
  let p = checkpoints.get(key);
  if (!p) {
    p = Promise.race([
      loadLiveRepository().then((repo) => repo.checkpoint(lectureId, { first, last, idea })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Checkpoint timed out')), 120_000)),
    ]);
    p.catch(() => checkpoints.delete(key));
    checkpoints.set(key, p);
  }
  return p;
}

/** Read an explanation against the idea's key points. The first time for an idea also writes those. */
export function teachBack(lectureId: string, first: number, last: number, idea: string, explanation: string): Promise<TeachBack> {
  return Promise.race([
    loadLiveRepository().then((repo) => repo.teachBack(lectureId, { first, last, idea, explanation })),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Teach-back timed out')), 120_000)),
  ]);
}

/**
 * Which ideas of the course build on which. Asked once `ready` (enough
 * lectures grouped); a partial answer is asked again when the rest arrive.
 */
export function useCourseLinks(
  courseId: string | undefined,
  ready: boolean,
  grouped: number,
): { state: 'idle' | 'loading' | 'ready' | 'error'; links: ReaderLink[] } {
  const [out, setOut] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; links: ReaderLink[] }>({
    state: 'idle',
    links: [],
  });
  useEffect(() => {
    if (!courseId || !ready || !isLive(courseId)) return;
    let alive = true;
    setOut((o) => ({ ...o, state: o.links.length ? o.state : 'loading' }));
    loadLiveRepository()
      .then((repo) => repo.courseLinks(courseId))
      .then((r) => alive && setOut({ state: 'ready', links: r.links }))
      .catch(() => alive && setOut((o) => ({ ...o, state: o.links.length ? 'ready' : 'error' })));
    return () => {
      alive = false;
    };
  }, [courseId, ready, grouped]);
  return out;
}

export async function saveRehearsal(courseId: string, title: string, lectureIds: string[], results: RehearsalResult[]) {
  const repo = await loadLiveRepository();
  return repo.saveRehearsal(courseId, { title, lecture_ids: lectureIds, results });
}

/**
 * Your rehearsals in this course, and the ideas you keep missing. `reload`
 * re-reads it — after a rehearsal is saved, say.
 */
export function useRehearsalHistory(courseId: string | undefined): {
  history: RehearsalHistory | null;
  reload: () => void;
} {
  const [history, setHistory] = useState<RehearsalHistory | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!courseId || !isLive(courseId)) return;
    let alive = true;
    loadLiveRepository()
      .then((repo) => repo.rehearsalHistory(courseId))
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setHistory(null));
    return () => {
      alive = false;
    };
  }, [courseId, tick]);
  return { history, reload: () => setTick((t) => t + 1) };
}
