import { useEffect, useState } from 'react';
import type { LectureConcept, LocalizedLectureBundle } from '@/types/domain';
import type { Lesson, LoadState, Space } from '../types';
import type { ExplainAnswer } from '../components/reader/iui/spec';
import { composeFromText, explainFor } from '../mocks/explain';
import { dataMode, loadLiveRepository, type ReaderConcept, type ReaderCourse, type ReaderLecture } from './liveRepository';
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
  }, [live, lessonId]);

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
  const [result, setResult] = useState<ExplainResult>({ state: 'loading', answer: null, fallback: false });
  const { title, markdown } = source;

  useEffect(() => {
    if (!live || !lessonId || !enabled) return;
    let alive = true;
    setResult({ state: 'loading', answer: null, fallback: false });
    once(answers, `${lessonId}:${page}`, async () => (await loadLiveRepository()).explainPage(lessonId, page))
      .then((a) => alive && setResult({ state: 'ready', answer: a, fallback: false }))
      .catch(() => alive && setResult({ state: 'ready', answer: composeFromText(title, markdown), fallback: true }));
    return () => {
      alive = false;
    };
  }, [live, lessonId, page, title, markdown, enabled]);

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
