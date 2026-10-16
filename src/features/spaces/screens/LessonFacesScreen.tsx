import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, ListChecks, Moon, PanelLeftClose, PanelLeftOpen, Smartphone, Sun, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PdfPager, sampleAccent } from '@/components/pdf';
import { addNote, deleteNote, notesError, notesForLesson, subscribeNotes, updateNote } from '../data/notes';
import { submitAnswer, usePracticeQuestions } from '../data/practice';
import { Scene, SURFACES } from '../components/Scene';
import { LessonPager } from '../components/LessonPager';
import { NoteEditor } from '../components/NoteEditor';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import {
  fetchCheckpoint,
  teachBack,
  isLive,
  saveRehearsal,
  useAsker,
  useExplain,
  useReaderContent,
  useReaderLesson,
  useRehearsalHistory,
  useRelated,
} from '../data/useReader';
import { markTrail } from '../data/trail';
import { useReadingProgress } from '../data/reading';
import { GlassPill } from '../components/reader/glass/GlassPill';
import { readPrefs, writePrefs, type ReaderPrefs } from '../data/readerPrefs';
import { useIdle } from '../components/reader/useIdle';
import { ChapterStrip, chaptersOf } from '../components/reader/ChapterStrip';
import { CheckpointCard } from '../components/reader/CheckpointCard';
import { TeachBack } from '../components/reader/TeachBack';
import { lightIdeas, type Light } from '../components/course/light';
import { BreakNudge, BreakRoom, useReadingCare } from '../components/reader/ReadingCare';
import { useMediaQuery } from '../data/useMediaQuery';
import { ReaderExit } from '../components/reader/ReaderHeader';
import { SelectionAsk } from '../components/reader/SelectionAsk';
import { TutorPanel, type Turn } from '../components/reader/TutorPanel';
import type { TutorCitation } from '../data/tutor';
import { Companion } from '../components/reader/Companion';
import { PracticePlane } from '../components/reader/PracticePlane';
import { ReadingFace } from '../components/reader/ReadingFace';
import { Spine } from '../components/reader/Spine';
import { Studio } from '../components/reader/Studio';
import { Spotlight } from '../components/reader/Spotlight';
import { LessonToc } from '../components/reader/LessonToc';
import { ExplainPanel } from '../components/reader/iui/ExplainPanel';
import { beatsFromMarkdown } from '../components/reader/beats';
import { FoundLine, type Found } from '../components/reader/FoundLine';
import { findRange } from '../components/reader/findText';
import { anchorY, timing } from '../components/reader/Planes';
import {
  anchorForPage,
  firstPageOf,
  materialPagesFrom,
  sectionsFromRows,
  spineConcepts,
  type Anchor,
} from '../components/reader/anchors';

/**
 * Reading a Lesson: the document, and a studio above it.
 *
 * The Material is the ground. The whole file, every page, scrolled like a
 * document, in a room that is a blurred still of the page you are at. It
 * never leaves. Everything else — the parsed text of the page you are on,
 * the tutor, your notes, the way into practice — is one layer above it: the
 * studio, summoned from the words and dismissed the same way. Closed, there
 * is the document and nothing else.
 *
 * One anchor, `{conceptId, page}`, read off the document's scroll. The studio
 * follows it: open the layer at page 6 and the text is at page 6. The other
 * way, the text's page chips and the tutor's citations scroll the document.
 *
 * You reach the studio from the words. Selecting on the page offers Ask,
 * Keep and **Read this**, which opens the layer at those words and underlines
 * them; selecting in the studio offers **Show page**, which scrolls the
 * document to them and lights them on the page. The Concept's name in the
 * page line at the bottom opens the layer too, and `\` toggles it.
 *
 * Reading changes no progress. Data comes through `useReaderLesson` and
 * `useReaderContent` — the mocks for demo ids, the backend for a real course
 * and lecture — whose return types are the endpoints' own.
 */

type CompanionState =
  | { kind: 'tutor'; title: string; page: number }
  | { kind: 'notes'; title: string; page: number };

/** The studio is a panel beside the document at this width; over it below. */
const PANEL = '(min-width: 1024px)';
/** The page never exceeds this. */
const MAX_SHEET = 1180;
/** Breathing room around the page inside its stage. */
const SHEET_PAD = { y: 16, side: 56 };
/** The contents list shows at this width — beside the page alone, or beside page and panel. */
const TOC_ALONE = 1180;
const TOC_WITH_PANEL = 1640;
const TOC_WIDTH = 260;

type View = 'slide' | 'explain' | 'text';
/* Labels live in the v4Reader namespace (views.page / views.explain / views.text). */
const VIEWS: { id: View; label: 'page' | 'explain' | 'text' }[] = [
  { id: 'slide', label: 'page' },
  { id: 'explain', label: 'explain' },
  { id: 'text', label: 'text' },
];

export default function LessonFacesScreen() {
  const { t: tr } = useTranslation('v4Reader');
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const { state, space, lesson, prev, next } = useReaderLesson(spaceId, lessonId);
  const content = useReaderContent(spaceId, lessonId);
  const reduce = useReducedMotion();
  const panel = useMediaQuery(PANEL);
  /* `?page=34&view=explain` — the Lesson overview's way in, at a page and a view. */
  const [params] = useSearchParams();
  const askedPage = Number(params.get('page')) || null;
  const askedView = params.get('view');
  /* `&spot=words` — a search hit: light those words on the page once it is up. */
  const askedSpot = params.get('spot');

  const sections = useMemo(
    () => (content.bundle ? sectionsFromRows(content.bundle.slides, content.concepts) : []),
    [content.bundle, content.concepts],
  );
  const concepts = useMemo(() => spineConcepts(sections, lesson?.concepts ?? []), [sections, lesson]);
  const pages = useMemo(() => materialPagesFrom(sections), [sections]);

  const [view, setView] = useState<View>(() =>
    askedView === 'explain' || askedView === 'text' ? askedView : 'slide',
  );
  const studio = view !== 'slide';
  /* The words lit on the page — by Explain's parts, or by stepping the slide's points. */
  const [spot, setSpot] = useState<string | null>(() => askedSpot?.slice(0, 120) || null);
  /* The point of the page the slide view is on; -1 is the whole page. */
  const [beat, setBeat] = useState(-1);
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [companion, setCompanion] = useState<CompanionState | null>(null);
  const [bench, setBench] = useState<'practice' | null>(null);
  const [quote, setQuote] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnId = useRef(0);
  const mintTurnId = useCallback(() => turnId.current++, []);
  const [noteTick, setNoteTick] = useState(0);
  /*
   * Re-read notes when the store changes on its own — a live note getting its
   * real id, or a failed write being taken back. Kept apart from `noteTick`,
   * which also clears the new-note box: a server reply must never wipe
   * something half-written.
   */
  const [, setNotesSeen] = useState(0);
  useEffect(() => subscribeNotes(() => setNotesSeen((n) => n + 1)), []);
  const [accent, setAccent] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const foundNonce = useRef(0);
  const [box, setBox] = useState({ w: MAX_SHEET, h: 600 });
  const [numPages, setNumPages] = useState(0);
  /* The page in view. The document is a deck: one page, turned sideways. */
  const [pdfPage, setPdfPage] = useState(() => askedPage ?? 1);


  const pdfRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const liveReader = !!spaceId && isLive(spaceId);
  /* Count the reading: progress, visits and the streak, page by page. */
  useReadingProgress(lessonId, pdfPage, liveReader && numPages > 0);
  /* The practice bench: the lecture's real questions when live. */
  const practice = usePracticeQuestions(lessonId, liveReader);

  /* Leave a mark where you are, so the course can offer to pick up here. */
  useEffect(() => {
    if (!spaceId || !lessonId || !numPages || !isLive(spaceId)) return;
    markTrail(lessonId, { page: pdfPage, pages: numPages, course: spaceId });
  }, [spaceId, lessonId, pdfPage, numPages]);

  useEffect(() => {
    if (anchor || sections.length === 0) return;
    const asked = askedPage ? anchorForPage(askedPage, sections) : null;
    if (asked) {
      setAnchor(asked);
      setPdfPage(asked.page);
      return;
    }
    setAnchor({ conceptId: sections[0].conceptId, page: sections[0].blocks[0].page });
  }, [anchor, sections, askedPage]);


  /*
   * The ideas can arrive after the pages (a live deck is one section until
   * they are grouped), so the anchor is re-placed under the section its page
   * now belongs to.
   */
  useEffect(() => {
    if (!anchor || sections.length === 0) return;
    if (sections.some((sec) => sec.conceptId === anchor.conceptId && sec.blocks.some((b) => b.page === anchor.page))) return;
    const again = anchorForPage(anchor.page, sections);
    if (again) setAnchor(again);
  }, [sections, anchor]);

  const ready = Boolean(content.bundle && content.pdfUrl && anchor);
  /*
   * The page fits the window whole; the window is measured, not assumed.
   * Where the studio docks as a panel, the page is sized for the room left
   * beside it, so opening the studio moves the page and never covers it.
   */
  useEffect(() => {
    const el = pdfRef.current;
    if (!el) return;
    const read = () =>
      setBox({
        w: Math.min(MAX_SHEET, el.clientWidth - SHEET_PAD.side * 2),
        h: el.clientHeight - SHEET_PAD.y * 2,
      });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
    /* `ready`: the pager mounts a render after the bundle, once there is an anchor. */
  }, [ready]);

  /* Reset when the Lesson changes — React's documented way, during render. */
  const [readingId, setReadingId] = useState(lessonId);
  if (readingId !== lessonId) {
    setReadingId(lessonId);
    setView('slide');
    setSpot(null);
    setBeat(-1);
    setAnchor(null);
    setEngaged(false);
    setCompanion(null);
    setBench(null);
    setQuote(undefined);
    setTurns([]);
    setAccent(null);
    setFound(null);
    setPdfPage(1);
  }

  const engage = useCallback(() => setEngaged(true), []);
  const openStudio = useCallback(() => {
    engage();
    setBench(null);
    setView('text');
  }, [engage]);
  const closeStudio = useCallback(() => {
    setView('slide');
    setCompanion(null);
    setSpot(null);
  }, []);
  /*
   * Escape peels one layer. The companion's own Escape closes the companion;
   * the studio's Escape, fired by the same key press, must not take the
   * studio with it. A ref, because both handlers run on the same event and
   * the state has not caught up.
   */
  const companionOpen = useRef(false);
  const escapeStudio = useCallback(() => {
    if (companionOpen.current) {
      setCompanion(null);
      return;
    }
    setView('slide');
    setSpot(null);
  }, []);

  /* The page in view is the anchor. */
  const onPdfPage = useCallback(
    (page: number) => {
      setPdfPage(page);
      setBeat(-1);
      setSpot(null);
      const a = anchorForPage(page, sections);
      if (a) setAnchor(a);
    },
    [sections],
  );

  /* Take the document to a page. The studio follows through the anchor. */
  const goToPage = useCallback(
    (page: number) => {
      const a = anchorForPage(page, sections);
      if (!a) return;
      engage();
      setBench(null);
      setAnchor(a);
      setPdfPage(page);
      setBeat(-1);
    },
    [sections, engage],
  );
  const turnPage = useCallback(
    (by: number) => onPdfPage(Math.min(Math.max(1, pdfPage + by), numPages || 1)),
    [onPdfPage, pdfPage, numPages],
  );

  const blockOf = useCallback(
    (p: number) => sections.flatMap((s) => s.blocks).find((b) => b.page === p) ?? null,
    [sections],
  );
  const beatsOf = useCallback(
    (p: number) => {
      const b = blockOf(p);
      return b ? beatsFromMarkdown(b.markdown) : [];
    },
    [blockOf],
  );

  /*
   * Down steps into the page, one point at a time, each lit on the slide;
   * past the last point it turns to the next page. Up walks back the same
   * way, arriving on the previous page at its last point.
   */
  const stepBeat = useCallback(
    (by: 1 | -1) => {
      const list = beatsOf(pdfPage);
      if (by > 0) {
        if (beat < list.length - 1) {
          setBeat(beat + 1);
          setSpot(list[beat + 1].text);
        } else if (pdfPage < numPages) onPdfPage(pdfPage + 1);
        return;
      }
      if (beat > -1) {
        setBeat(beat - 1);
        setSpot(beat - 1 >= 0 ? list[beat - 1].text : null);
      } else if (pdfPage > 1) {
        const before = beatsOf(pdfPage - 1);
        onPdfPage(pdfPage - 1);
        setBeat(before.length - 1);
        setSpot(before.length ? before[before.length - 1].text : null);
      }
    },
    [beatsOf, pdfPage, beat, numPages, onPdfPage],
  );
  const pickBeat = useCallback(
    (i: number) => {
      const list = beatsOf(pdfPage);
      setBeat(i);
      setSpot(i >= 0 ? list[i]?.text ?? null : null);
    },
    [beatsOf, pdfPage],
  );

  /*
   * The same sentence, found on the other side. Tried over a couple of
   * seconds of frames: the studio may still be mounting, or the page still
   * painting its text layer. Words outside the window are brought to the
   * anchor line first.
   */
  const findOn = useCallback((where: 'pdf' | 'text', text: string, page?: number) => {
    const nonce = ++foundNonce.current;
    let tries = 0;
    /* On the deck, only the page in view, and only once it has slid in. */
    const settleUntil = where === 'pdf' ? performance.now() + 450 : 0;
    const tick = () => {
      if (foundNonce.current !== nonce) return;
      if (performance.now() < settleUntil) {
        requestAnimationFrame(tick);
        return;
      }
      const root = (where === 'pdf' ? pdfRef : textRef).current;
      const el =
        where === 'pdf' && page !== undefined
          ? root?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`) ?? null
          : root;
      const range = el ? findRange(el, text) : null;
      if (!range) {
        if (++tries < 150) requestAnimationFrame(tick);
        return;
      }
      let rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
      if (rects.length === 0) return;
      const first = rects[0];
      if (where === 'text' && root && (first.top < 80 || first.bottom > window.innerHeight - 80)) {
        root.scrollBy({ top: first.top - anchorY(), behavior: 'auto' });
        rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
      }
      setFound({ rects, nonce });
    };
    requestAnimationFrame(tick);
  }, []);

  const closeCompanion = useCallback(() => setCompanion(null), []);
  const closeBench = useCallback(() => setBench(null), []);

  /* Which page a selection was made on — a slot of the document, or a block of the text. */
  const pageOfSelection = (): number | null => {
    const node = document.getSelection()?.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    const slot = el?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage;
    const block = el?.closest<HTMLElement>('[data-page]')?.dataset.page;
    const v = slot ?? block;
    return v ? Number(v) : null;
  };

  /* A pointer press leaves no ring behind; a keyboard press keeps its focus. */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return;
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement) el.blur();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  /*
   * Arrow keys and Page Up/Down turn the page. Not in a field, not inside
   * the studio (its text scrolls with them), not while practising.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bench || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, [contenteditable="true"], [aria-label="Studio"]')) return;
      const by =
        e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      const step = view === 'slide' ? (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0) : 0;
      if (!by && !step) return;
      e.preventDefault();
      if (by) turnPage(by);
      else stepBeat(step as 1 | -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bench, turnPage, stepBeat, view]);

  /* `\` toggles the studio. Not in a field, not while practising. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || bench) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      if (studio) closeStudio();
      else openStudio();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studio, bench, openStudio, closeStudio]);

  /* Settings that belong to this viewer: night paper, pinned contents, the hint seen. */
  const [prefs, setPrefs] = useState<ReaderPrefs>(readPrefs);
  const setPref = useCallback((patch: Partial<ReaderPrefs>) => setPrefs(writePrefs(patch)), []);
  /* The hint is for a first visit: the first page turned, it has done its work. */
  const firstPage = useRef(pdfPage);
  useEffect(() => {
    if (!prefs.hinted && pdfPage !== firstPage.current) setPref({ hinted: true });
  }, [pdfPage, prefs.hinted, setPref]);

  /*
   * A long session is mostly looking at one page. On the plain slide, once
   * nothing has moved for a few seconds, everything but the page fades away;
   * the first touch brings it all back. A hairline of progress stays.
   */
  const care = useReadingCare(pdfPage, ready);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  /* The idea being explained back, if any. */
  const [teaching, setTeaching] = useState<{ id: string; name: string; first: number; last: number } | null>(null);
  /*
   * A slide is landscape; a phone held upright shows it at a third of the
   * screen. Said once, and gone for good the first time the phone is turned.
   */
  const portraitPhone = useMediaQuery('(max-width: 639px) and (orientation: portrait)');
  /*
   * A short window (a phone on its side) cannot spare bands above and below
   * the page: there the page takes the whole height and the controls float
   * over it, fading when idle — the way a video player does it.
   */
  const short = useMediaQuery('(max-height: 520px)');
  /* Controls that float over the page need a ground of their own; on the black they need none. */
  const overPage = short ? 'bg-black/70 backdrop-blur-md' : 'bg-white/[0.07]';
  const wasPortrait = useRef(false);
  useEffect(() => {
    if (portraitPhone) wasPortrait.current = true;
    else if (wasPortrait.current && !prefs.turned) setPref({ turned: true });
  }, [portraitPhone, prefs.turned, setPref]);
  const quiet = useIdle(ready && view === 'slide' && !bench && !care.due && !care.resting && !checkpointOpen && !teaching, 2800);

  /*
   * Where the page actually is, so the chapter strip can sit on its top edge
   * at exactly its width. Read from the slot's layout size (its transform is
   * only the turn) and the stage it is centred in.
   */
  const stageRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const read = () => {
      const slot = stage.querySelector<HTMLElement>(`[data-pdf-page="${pdfPage}"]`);
      if (!slot || !slot.offsetWidth) return;
      const w = slot.offsetWidth;
      const h = slot.offsetHeight;
      const next = {
        left: Math.round(stage.offsetLeft + (stage.clientWidth - w) / 2),
        top: Math.round(stage.offsetTop + (stage.clientHeight - h) / 2),
        width: Math.round(w),
      };
      setFrame((f) => (f && f.left === next.left && f.top === next.top && f.width === next.width ? f : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(stage);
    const mo = new MutationObserver(read);
    /* A page painting in can change the slot's size; the turn's transform cannot. */
    mo.observe(stage, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [pdfPage, ready, numPages]);

  /*
   * Checkpoints. The ideas as page ranges; turning forward off an idea's
   * last page offers one question on it. The question is fetched while you
   * are still on that last page, so it is usually there when you turn.
   */
  const liveDeck = isLive(spaceId, lessonId);
  const ideaRanges = useMemo(
    () => (sections.length ? chaptersOf(sections, numPages || Math.max(...sections.flatMap((x) => x.blocks.map((b) => b.page)))) : []),
    [sections, numPages],
  );
  const { history, reload: reloadHistory } = useRehearsalHistory(liveDeck ? spaceId : undefined);
  const [checked, setChecked] = useState<Record<string, Light>>({});
  const [passed, setPassed] = useState<Set<string>>(() => new Set());
  const [offer, setOffer] = useState<(typeof ideaRanges)[number] | null>(null);
  const lastPage = useRef(pdfPage);
  useEffect(() => {
    const from = lastPage.current;
    lastPage.current = pdfPage;
    if (!liveDeck || !lessonId) return;
    const here = ideaRanges.find((c) => pdfPage >= c.first && pdfPage <= c.last);
    if (here && pdfPage === here.last && here.last > here.first) {
      fetchCheckpoint(lessonId, here.first, here.last, here.name).catch(() => {});
    }
    const left = ideaRanges.find((c) => c.last === from);
    if (left && pdfPage === from + 1 && left.last > left.first && !passed.has(left.id) && !checked[left.id]) {
      setOffer(left);
    } else if (offer && pdfPage !== from) {
      /* Moving on without answering is an answer too: the offer goes. */
      setOffer(null);
    }
  }, [pdfPage, ideaRanges, liveDeck, lessonId, passed, checked, offer]);
  const dismissOffer = useCallback(() => {
    setOffer((o) => {
      if (o) setPassed((p) => new Set(p).add(o.id));
      return null;
    });
  }, []);
  /* What lights each idea on the strip: past rehearsals and checkpoints, then this visit's. */
  const ideaLights = useMemo(() => {
    const base = lessonId ? lightIdeas(lessonId, ideaRanges.map((c) => ({ first_page: c.first })), history?.marks ?? []) : [];
    return ideaRanges.map((c, i) => checked[c.id] ?? base[i] ?? 'dark');
  }, [ideaRanges, history, checked, lessonId]);

  const asker = useAsker(spaceId, lessonId);
  /* The idea in view, wherever else the course teaches it. */
  const ideaName = anchor ? sections.find((x) => x.conceptId === anchor.conceptId)?.name ?? '' : '';
  const relatedFound = useRelated(spaceId, lessonId, view === 'explain' ? ideaName : '');
  /* A question handed to Explain from outside it — words selected on the page. */
  const [queued, setQueued] = useState<{ question: string; n: number } | null>(null);
  const queuedN = useRef(0);
  /* Explain is asked only while it is the view: turning pages costs nothing. */
  const explainBlock = blockOf(pdfPage);
  const explained = useExplain(
    spaceId,
    lessonId,
    pdfPage,
    { title: explainBlock?.title ?? lesson?.title ?? '', markdown: explainBlock?.markdown ?? '' },
    view === 'explain',
  );

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.lessonFaces} motionKey={`faces-${lessonId}`} bare>
      {body}
    </Scene>
  );

  const exitTo = spaceId && lessonId ? `/v4/space/${spaceId}/lesson/${lessonId}` : '/v4/spaces';

  if (state === 'loading' || content.state === 'loading')
    return chrome(
      <>
        <ReaderExit to={exitTo} />
        <DetailSkeleton />
      </>,
    );
  if (state === 'error' || content.state === 'error')
    return chrome(
      <>
        <ReaderExit to={exitTo} />
        <SpacesError what="lesson" />
      </>,
    );
  if (!space || !lesson)
    return chrome(
      <NotFound
        what="lesson"
        back={space ? { to: `/v4/space/${space.id}`, space: space.name } : { to: '/v4/spaces', place: 'spaces' }}
      />,
    );

  const back = `/v4/space/${space.id}/lesson/${lesson.id}`;

  /* Content is here and the anchor lands next render — not "nothing to read". */
  if (content.bundle && content.pdfUrl && sections.length > 0 && !anchor)
    return chrome(
      <>
        <ReaderExit to={back} />
        <DetailSkeleton />
      </>,
    );
  if (!content.bundle || !content.pdfUrl || sections.length === 0 || !anchor)
    return chrome(
      <>
        <ReaderExit to={back} />
        <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 pt-14 text-center">
          <p className="mb-2 text-[17px] font-semibold">{tr('screen.empty.title')}</p>
          <p className="mb-7 max-w-[46ch] text-[14.5px] leading-relaxed text-quiet">
            {tr('screen.empty.body', { lesson: lesson.title })}
          </p>
          <Link
            to={back}
            className="console-focusable inline-flex h-11 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
          >
            {tr('screen.backToLesson')}
          </Link>
        </div>
      </>,
    );

  const myNotes = noteTick >= 0 ? notesForLesson(lesson.id) : [];
  const section = sections.find((s) => s.conceptId === anchor.conceptId) ?? sections[0];
  /* At the end of the deck, the way on to the next Lesson. */
  const pagerShowing = !bench && !studio && numPages > 0 && pdfPage === numPages;

  const landable = (c: TutorCitation) =>
    (c.conceptId !== undefined && sections.some((s) => s.conceptId === c.conceptId)) ||
    (c.materialPage !== undefined && pages.some((p) => p.page === c.materialPage));

  /*
   * Selected words, asked about. On a live lecture they are answered in
   * Explain, as an interface; elsewhere they go to the tutor as before.
   */
  const askInExplain = (question: string) => {
    engage();
    setCompanion(null);
    setView('explain');
    setQueued({ question, n: ++queuedN.current });
  };
  const askAbout = (text: string) => {
    const words = text.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (asker) {
      askInExplain(tr('screen.explainSelection', { words }));
      return;
    }
    setQuote(text);
    openTutor(text.length > 60 ? `${text.slice(0, 57)}…` : text, pageOfSelection() ?? anchor.page);
  };

  const openTutor = (title: string, page: number) => {
    openStudio();
    setCompanion({ kind: 'tutor', title, page });
  };
  const openNotes = (page: number) => {
    openStudio();
    setCompanion({ kind: 'notes', title: tr('screen.notes.title', { lesson: lesson.title }), page });
  };

  const tutorNode = (
    <TutorPanel
      lesson={lesson}
      groundingEnabled={space.groundingEnabled}
      onCiteConcept={(id) => {
        const p = firstPageOf(id, sections);
        if (p !== null) goToPage(p);
      }}
      onCiteMaterial={(p) => goToPage(p)}
      pendingQuote={quote}
      onQuoteConsumed={() => setQuote(undefined)}
      turns={turns}
      onTurnsChange={setTurns}
      mintTurnId={mintTurnId}
      landable={landable}
    />
  );

  const notesNode = (
    <div className="space-y-2.5 px-4 py-4">
      {myNotes.map((n) => (
        <NoteEditor
          key={n.id}
          value={n.body}
          onSave={(body) => {
            updateNote(n.id, body);
            setNoteTick((t) => t + 1);
          }}
          onDelete={() => {
            deleteNote(n.id);
            setNoteTick((t) => t + 1);
          }}
        />
      ))}
      <NoteEditor
        key={`new-${noteTick}`}
        placeholder={tr('screen.notes.placeholder')}
        onSave={(body) => {
          addNote({ lessonId: lesson.id, body, lessonTitle: lesson.title, spaceId: space.id, spaceName: space.name });
          setNoteTick((t) => t + 1);
        }}
      />
      {notesError() && (
        <p role="alert" className="px-1 text-[13px] text-destructive">
          {notesError()}
        </p>
      )}
      {myNotes.length === 0 && (
        <p className="px-1 text-[13px] text-faint">{tr('screen.notes.empty')}</p>
      )}
    </div>
  );

  companionOpen.current = companion !== null;
  const companionNode = companion && (
    <Companion
      open
      title={companion.title}
      onClose={closeCompanion}
      className={companion.kind === 'tutor' ? 'h-[min(60vh,560px)]' : undefined}
      footer={
        <button
          type="button"
          onClick={() => {
            setCompanion(null);
            setBench('practice');
          }}
          className="console-focusable inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <ListChecks aria-hidden className="h-3.5 w-3.5" />
          {tr('screen.practiseIdea')}
        </button>
      }
    >
      {companion.kind === 'tutor' ? tutorNode : notesNode}
    </Companion>
  );

  const footer = (
    <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-8">
      {lesson.practiceCount > 0 && (
        <button
          type="button"
          onClick={() => {
            engage();
            setCompanion(null);
            setBench('practice');
          }}
          className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14.5px] font-semibold text-slate-900"
        >
          <ListChecks aria-hidden className="h-4 w-4" />
          {tr('screen.practiseRead')}
        </button>
      )}
      <Link
        to={back}
        className="console-focusable inline-flex h-12 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
      >
        {tr('screen.backToLesson')}
      </Link>
    </div>
  );

  const docked = studio && panel;
  /* The panel's width beside the page: half-ish, never cramped, never vast. */
  const panelWidth = Math.round(Math.min(680, Math.max(440, vw * 0.42)));
  /* The full contents only when pinned; otherwise the spine's hairline index. */
  const showToc = prefs.tocPinned && vw >= (docked ? TOC_WITH_PANEL : TOC_ALONE);
  const canPin = vw >= (docked ? TOC_WITH_PANEL : TOC_ALONE);
  /* Chrome fades as one; it comes back faster than it goes. */
  const fade = {
    initial: false,
    animate: { opacity: quiet ? 0 : 1 },
    transition: { duration: quiet ? 0.9 : 0.2 },
  } as const;
  const night = prefs.night;
  /* The ideas as a strip on the slide's top edge; it needs a band above the page. */
  const chapters = chaptersOf(sections, numPages || Math.max(...sections.flatMap((x) => x.blocks.map((b) => b.page))));
  const strip = chapters.length >= 2;
  const stageTop = short ? 0 : 88 + (strip ? 48 : 0);
  /* The stage's own width decides whether the masthead can sit centred beside the switch. */
  const narrowHead = vw - (docked ? panelWidth : 0) - (showToc ? TOC_WIDTH : 0) < 980;
  const block = blockOf(pdfPage);
  const beats = beatsOf(pdfPage);
  /* The slide view keeps a band under the page for its points. */
  /* The first-visit hint takes a line of its own under the points. */
  const hintShown = !prefs.hinted && !engaged && view === 'slide';
  const stageBottom = short ? 0 : (view === 'slide' && beats.length >= 2 ? 128 : 88) + (hintShown ? 22 : 0);

  return chrome(
    <div
      className="relative h-[100dvh] overflow-hidden bg-black"
      style={accent ? ({ '--reader-accent': accent } as React.CSSProperties) : undefined}
    >
      <FoundLine found={found} />

      {/* Words on the page. */}
      <SelectionAsk
        articleRef={pdfRef}
        also={{
          label: tr('screen.select.read'),
          onPress: (text) => {
            openStudio();
            findOn('text', text);
          },
        }}
        onAsk={(text) => askAbout(text)}
        askLabel={asker ? tr('screen.select.explain') : undefined}
        onSaveNote={(text) => {
          addNote({ lessonId: lesson.id, body: `“${text}”`, lessonTitle: lesson.title, spaceId: space.id, spaceName: space.name });
          setNoteTick((t) => t + 1);
          openNotes(pageOfSelection() ?? anchor.page);
        }}
      />
      {/* Words in the studio. */}
      <SelectionAsk
        articleRef={textRef}
        also={{
          label: tr('screen.select.showPage'),
          onPress: (text) => {
            const p = pageOfSelection() ?? anchor.page;
            goToPage(p);
            findOn('pdf', text, p);
          },
        }}
        onAsk={(text) => askAbout(text)}
        askLabel={asker ? tr('screen.select.explain') : undefined}
        onSaveNote={(text) => {
          addNote({ lessonId: lesson.id, body: `“${text}”`, lessonTitle: lesson.title, spaceId: space.id, spaceName: space.name });
          setNoteTick((t) => t + 1);
          openNotes(pageOfSelection() ?? anchor.page);
        }}
      />

      <motion.div {...fade}>
        <ReaderExit to={back} />
      </motion.div>

      {/* The masthead: where you are, what this is, and how to look at it. */}
      {/* Centred where there is room; beside the exit, clear of the switch, where there is not. */}
      <motion.header
        {...fade}
        className={cn(
          /* Below sm the switch needs the top row; the strip names where you are. */
          'pointer-events-none absolute inset-x-0 top-0 z-20 hidden h-[88px] items-center',
          !short && 'sm:flex',
          narrowHead ? 'justify-start pl-16 pr-[248px]' : 'justify-center px-20',
        )}
        style={{ right: docked ? panelWidth : 0, left: showToc ? TOC_WIDTH : 0 }}
      >
        <div className={cn('min-w-0', !narrowHead && 'text-center')}>
          <p className="mb-1 truncate text-[12.5px] text-quiet">
            {space.name}
            {!strip && (
              <>
                <span aria-hidden className="mx-2 text-faint">·</span>
                {section.name}
              </>
            )}
          </p>
          <h1 className="truncate text-[22px] font-medium leading-tight tracking-[-0.015em] text-foreground">
            {lesson.title}
          </h1>
        </div>
      </motion.header>

      {/* How to look at the page: alone, explained, or as text. */}
      <motion.div {...fade} className="absolute top-5 z-[41] flex items-center gap-2" style={{ right: docked ? panelWidth + 20 : 20 }}>
      {/* The page's own settings: the contents kept open, and night paper. */}
      <div className={cn('flex rounded-full p-1', overPage)}>
        {canPin && (
          <button
            type="button"
            onClick={() => setPref({ tocPinned: !prefs.tocPinned })}
            aria-pressed={prefs.tocPinned}
            aria-label={prefs.tocPinned ? tr('screen.toc.hide') : tr('screen.toc.keep')}
            title={prefs.tocPinned ? tr('screen.toc.hide') : tr('screen.toc.keep')}
            className="console-focusable flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
          >
            {prefs.tocPinned ? <PanelLeftClose aria-hidden className="h-4 w-4" /> : <PanelLeftOpen aria-hidden className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPref({ night: !night })}
          aria-pressed={night}
          aria-label={night ? tr('screen.paper.light') : tr('screen.paper.night')}
          title={night ? tr('screen.paper.light') : tr('screen.paper.nightHint')}
          className="console-focusable flex h-8 w-8 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
        >
          {night ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
        </button>
      </div>
      <div
        role="tablist"
        aria-label={tr('views.label')}
        className={cn('flex rounded-full p-1', overPage)}
      >
        {VIEWS.map((v) => {
          const on = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                engage();
                setSpot(null);
                setBeat(-1);
                if (v.id !== 'text') setCompanion(null);
                setView(v.id);
              }}
              className={cn(
                'console-focusable relative h-8 rounded-full px-4 text-[13px] transition-colors',
                on ? 'text-background' : 'text-quiet hover:text-foreground',
              )}
            >
              {on && (
                <motion.span
                  layoutId="faces-view"
                  transition={{ duration: reduce ? 0 : timing.card }}
                  className="absolute inset-0 rounded-full bg-white"
                />
              )}
              <span className="relative">{tr(`views.${v.label}`)}</span>
            </button>
          );
        })}
      </div>
      </motion.div>

      <motion.div {...fade}>
      {showToc ? (
        <div className="absolute bottom-24 left-0 top-[120px] z-20 overflow-y-auto overflow-x-hidden pl-8 pr-4" style={{ width: TOC_WIDTH }}>
          <LessonToc sections={sections} conceptId={anchor.conceptId} page={pdfPage} onPage={goToPage} />
        </div>
      ) : (
        !strip && (
          <Spine
            concepts={concepts}
            currentId={anchor.conceptId}
            right={docked ? panelWidth + 12 : 12}
            onJump={(id) => {
              const p = firstPageOf(id, sections);
              if (p !== null) goToPage(p);
            }}
          />
        )
      )}
      </motion.div>

      {/*
        The stage: the page, alone in the space the masthead, the contents
        and the panel leave. It refits when that space changes.
      */}
      <div
        ref={stageRef}
        className={cn('absolute', night && '[&_[data-pdf-page]]:bg-[#141414] [&_[data-pdf-page]_canvas]:[filter:invert(0.9)_hue-rotate(180deg)]')}
        style={{
          top: stageTop,
          bottom: stageBottom,
          left: showToc ? TOC_WIDTH : 0,
          right: docked ? panelWidth : 0,
        }}
      >
        <PdfPager
          file={content.pdfUrl}
          page={pdfPage}
          onPageChange={onPdfPage}
          onStep={view === 'slide' ? stepBeat : undefined}
          maxWidth={box.w}
          maxHeight={box.h}
          onLoad={setNumPages}
          onFirstRender={(canvas) => setAccent(sampleAccent(canvas))}
          rootRef={pdfRef}
          overlay={<Spotlight words={spot} />}
          className="absolute inset-0 overflow-hidden"
        />
      </div>

      {portraitPhone && !prefs.turned && ready && (
        <motion.div {...fade} className="absolute inset-x-4 top-[72px] z-30 flex justify-center">
          <p className="flex items-center gap-2 rounded-full bg-white/[0.08] py-1.5 pl-4 pr-1.5 text-[12.5px] text-foreground">
            <Smartphone aria-hidden className="h-3.5 w-3.5 rotate-90 text-quiet" />
            {tr('screen.turnPhone')}
            <button
              type="button"
              aria-label={tr('screen.gotIt')}
              onClick={() => setPref({ turned: true })}
              className="console-focusable flex h-7 w-7 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </p>
        </motion.div>
      )}

      {/* The lecture's ideas, along the top edge of the page. */}
      {strip && !short && (
        <motion.div
          {...fade}
          className="absolute z-20"
          style={
            frame
              ? { left: frame.left, top: Math.max(84, frame.top - 46), width: frame.width }
              : /* Before the page is measured: the stage's own width, inset like the sheet. */
                { left: (showToc ? TOC_WIDTH : 0) + SHEET_PAD.side, right: (docked ? panelWidth : 0) + SHEET_PAD.side, top: stageTop - 46 }
          }
        >
          <ChapterStrip chapters={chapters} page={pdfPage} onJump={goToPage} lights={ideaLights} />
        </motion.div>
      )}

      {/*
        The slide's points, stepped by scrolling — the page's own explorer.
        At rest it is a row of dots, one per point; pointing at it gives the
        names, and the words of a point show only while you are on it.
      */}
      {view === 'slide' && beats.length >= 2 && (
        <div
          className="pointer-events-none absolute z-20 flex flex-col items-center justify-end gap-2 px-6"
          style={{ bottom: hintShown ? 88 : 66, height: 64, left: showToc ? TOC_WIDTH : 0, right: 0 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {beat >= 0 && (
              <motion.p
                key={`${pdfPage}-${beat}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: timing.mark }}
                className="line-clamp-1 max-w-[68ch] text-center text-[14.5px] leading-[1.45] text-foreground"
              >
                {beats[beat].text}
              </motion.p>
            )}
          </AnimatePresence>
          <motion.div {...fade} className={cn('pointer-events-auto rounded-full', short && 'bg-black/70 backdrop-blur-md')}>
            <PointDots beats={beats} beat={beat} onPick={pickBeat} />
          </motion.div>
        </div>
      )}

      {/* The page line: where you are, and the turn. */}
      <motion.div
        {...fade}
        className="pointer-events-none absolute bottom-5 z-30 flex flex-col items-center gap-2 px-4"
        style={{ left: showToc ? TOC_WIDTH : 0, right: docked ? panelWidth : 0 }}
      >
        {hintShown && !short && (
          <p className="hidden text-[12px] text-faint sm:block">
            {beats.length >= 2 ? tr('screen.hint.withPoints') : tr('screen.hint.plain')}
          </p>
        )}
        <GlassPill
          sourceRef={pdfRef}
          watch={`${pdfPage}-${night}`}
          paperFilter={night ? 'invert(0.9) hue-rotate(180deg)' : undefined}
          className="pointer-events-auto text-[12.5px]"
        >
          <button
            type="button"
            onClick={() => turnPage(-1)}
            disabled={pdfPage <= 1}
            aria-label={tr('screen.prevPage')}
            className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </button>
          <span className="min-w-[4.5rem] shrink-0 text-center tabular-nums text-quiet">
            <span className="text-foreground">{pdfPage}</span>
            {numPages > 0 && <span className="text-faint"> / {numPages}</span>}
          </span>
          <button
            type="button"
            onClick={() => turnPage(1)}
            disabled={numPages > 0 && pdfPage >= numPages}
            aria-label={tr('screen.nextPage')}
            className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
        </GlassPill>
      </motion.div>

      {/* Where you are in the deck, as a hairline that stays when everything else has gone. */}
      {numPages > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 z-30 h-[2px] bg-white/[0.05]"
          style={{ left: showToc ? TOC_WIDTH : 0, right: docked ? panelWidth : 0 }}
        >
          <motion.div
            className="h-full origin-left"
            style={{ background: 'var(--reader-accent, hsl(var(--secondary)))', opacity: 0.75 }}
            initial={false}
            animate={{ scaleX: pdfPage / numPages }}
            transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      )}

      <CheckpointCard
        idea={care.due || care.resting ? null : offer && { name: offer.name, first: offer.first, last: offer.last }}
        lectureTitle={lesson.title}
        load={() => fetchCheckpoint(lesson.id, offer?.first ?? 1, offer?.last ?? 1, offer?.name ?? '')}
        pageHref={(p) => `/v4/space/${space.id}/lesson/${lesson.id}/faces?page=${p}`}
        onDone={(outcome) => {
          if (!offer) return;
          setChecked((c) => ({ ...c, [offer.id]: outcome.correct === outcome.total ? 'lit' : 'weak' }));
          saveRehearsal(
            space.id,
            tr('screen.saved.checkpoint', { idea: offer.name }).slice(0, 120),
            [lesson.id],
            outcome.results.map((r) => ({ ...r, idea: r.idea.slice(0, 60), lecture_id: lesson.id })),
          )
            .then(reloadHistory)
            .catch(() => {});
        }}
        onOpenChange={setCheckpointOpen}
        onTeach={() => {
          if (offer) setTeaching(offer);
          dismissOffer();
        }}
        onDismiss={dismissOffer}
      />
      <TeachBack
        idea={teaching}
        read={(text) => teachBack(lesson.id, teaching?.first ?? 1, teaching?.last ?? 1, teaching?.name ?? '', text)}
        onPage={(p) => {
          setTeaching(null);
          goToPage(p);
        }}
        onResult={(r) => {
          if (!teaching) return;
          setChecked((c) => ({ ...c, [teaching.id]: r.verdict === 'solid' ? 'lit' : 'weak' }));
          saveRehearsal(space.id, tr('screen.saved.teach', { idea: teaching.name }).slice(0, 120), [lesson.id], [
            { lecture_id: lesson.id, page: teaching.first, idea: teaching.name.slice(0, 60), kind: 'teach', correct: r.verdict === 'solid' },
          ])
            .then(reloadHistory)
            .catch(() => {});
        }}
        onClose={() => setTeaching(null)}
      />
      <BreakNudge
        care={care}
        checkHref={isLive(space.id, lesson.id) ? `/v4/space/${space.id}/rehearse?lectures=${lesson.id}` : undefined}
      />
      <BreakRoom care={care} page={pdfPage} />

      <Studio
        open={view === 'explain' && !bench}
        label={tr('views.explain')}
        where={section.name}
        page={anchor.page}
        onClose={escapeStudio}
        panel={panel}
        width={panelWidth}
      >
        <ExplainPanel
          answerKey={`${lesson.id}-${pdfPage}`}
          answer={explained.answer}
          fallback={explained.fallback}
          ask={asker ? (q, thread) => asker(pdfPage, q, thread) : null}
          queued={queued}
          related={
            relatedFound.length
              ? {
                  idea: ideaName,
                  links: relatedFound.map((r) => ({
                    label: tr('screen.relatedAt', { lesson: r.lecture_title, page: r.page }),
                    detail: r.title ?? '',
                    href: `/v4/space/${space.id}/lesson/${r.lecture_id}/faces?page=${r.page}&view=explain${
                      /«([^»]+)»/.exec(r.snippet) ? `&spot=${encodeURIComponent(/«([^»]+)»/.exec(r.snippet)![1])}` : ''
                    }`,
                  })),
                }
              : null
          }
          page={pdfPage}
          onSpot={setSpot}
          onAsk={(q) => {
            // Live, every question is answered in Explain by the real model —
            // the tutor panel only knows the fixtures' canned replies.
            if (asker) return askInExplain(q);
            setQuote(q);
            openTutor(q, pdfPage);
          }}
        />
      </Studio>

      <Studio
        open={view === 'text' && !bench}
        where={section.name}
        page={anchor.page}
        onClose={escapeStudio}
        panel={panel}
        width={panelWidth}
      >
        <ReadingFace
          title={lesson.title}
          sections={sections}
          focused
          engaged
          anchor={anchor}
          onAnchor={() => undefined}
          onOpenPage={(p) => goToPage(p)}
          onOpenNotes={(_id, page) => openNotes(page)}
          onAskFormula={(tex) => {
            if (asker) return askInExplain(`Explain this formula: ${tex}`);
            setQuote(tex);
            openTutor(tr('screen.thisFormula'), anchor.page);
          }}
          wide={false}
          companion={companion ? { page: companion.page, node: companionNode } : null}
          footer={footer}
          scrollRef={textRef}
          compact
          articleClassName="pb-[40vh] pl-14 pr-7 pt-9 [&_li]:text-[16px] [&_ol]:text-[16px] [&_p]:text-[16px] [&_ul]:text-[16px] [&_p]:leading-[1.65]"
        />
      </Studio>

      <PracticePlane
        open={bench === 'practice'}
        lessonTitle={lesson.title}
        questions={practice.questions}
        onClose={closeBench}
        onAnswer={liveReader ? (q, a) => submitAnswer(lesson.id, q.id, a) : undefined}
      />

      {pagerShowing && <LessonPager spaceId={space.id} prev={prev} next={next} keys={false} />}
    </div>,
  );
}

/**
 * A page's points as dots. Pointing at the row (or tabbing into it) opens
 * it into named chips; "All" is the whole page again.
 */
function PointDots({
  beats,
  beat,
  onPick,
}: {
  beats: { label: string }[];
  beat: number;
  onPick: (i: number) => void;
}) {
  const { t: tr } = useTranslation('v4Reader');
  const [open, setOpen] = useState(false);
  const items = [{ label: tr('screen.points.all'), i: -1 }, ...beats.map((b, i) => ({ label: b.label, i }))];
  return (
    <div
      role="tablist"
      aria-label={tr('screen.points.label')}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      className="flex max-w-[90vw] items-center gap-0.5 overflow-x-auto rounded-full px-1 [scrollbar-width:none]"
    >
      {items.map((b) => {
        const on = b.i === beat;
        return (
          <button
            key={b.i}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={b.label}
            title={open ? undefined : b.label}
            onClick={() => onPick(b.i)}
            className={cn(
              'console-focusable flex h-8 shrink-0 items-center justify-center rounded-full transition-colors',
              open ? 'px-3 text-[12.5px]' : 'w-6',
              open && (on ? 'bg-white/[0.16] text-foreground' : 'text-quiet hover:bg-white/[0.08] hover:text-foreground'),
            )}
          >
            {open ? (
              <span aria-hidden>{b.label}</span>
            ) : (
              <span
                aria-hidden
                className={cn(
                  'block rounded-full',
                  b.i < 0 ? 'h-1.5 w-3' : 'h-1.5 w-1.5',
                  on ? 'bg-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))]' : 'bg-white/[0.28]',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
