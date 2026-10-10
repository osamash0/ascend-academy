import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ListChecks } from 'lucide-react';
import { PdfScroll, sampleAccent, scrollToPdfPage } from '@/components/pdf';
import { addNote, deleteNote, notesForLesson, updateNote } from '../mocks/notes';
import { practiceForLesson } from '../mocks/practice';
import { Scene, SURFACES } from '../components/Scene';
import { LessonPager } from '../components/LessonPager';
import { NoteEditor } from '../components/NoteEditor';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { useLesson, useLessonContent } from '../data/useSpaces';
import { useMediaQuery } from '../data/useMediaQuery';
import { ReaderExit } from '../components/reader/ReaderHeader';
import { SelectionAsk } from '../components/reader/SelectionAsk';
import { TutorPanel, type Turn } from '../components/reader/TutorPanel';
import type { TutorCitation } from '../mocks/tutor';
import { Companion } from '../components/reader/Companion';
import { PracticePlane } from '../components/reader/PracticePlane';
import { ReadingFace } from '../components/reader/ReadingFace';
import { Spine } from '../components/reader/Spine';
import { Studio, STUDIO_WIDTH } from '../components/reader/Studio';
import { Room, RoomStill } from '../components/reader/Room';
import { FoundLine, type Found } from '../components/reader/FoundLine';
import { findRange } from '../components/reader/findText';
import { anchorLine, anchorY, timing } from '../components/reader/Planes';
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
 * Reading changes no progress. Data comes through `useLesson` and
 * `useLessonContent`, whose return types are the endpoints' own.
 */

type CompanionState =
  | { kind: 'tutor'; title: string; page: number }
  | { kind: 'notes'; title: string; page: number };

/** The studio is a panel beside the document at this width; over it below. */
const PANEL = '(min-width: 1024px)';
/** The page never exceeds this. */
const MAX_SHEET = 860;

export default function LessonFacesScreen() {
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const { state, space, lesson, prev, next } = useLesson(spaceId, lessonId);
  const content = useLessonContent(lessonId);
  const reduce = useReducedMotion();
  const panel = useMediaQuery(PANEL);

  const sections = useMemo(
    () => (content.bundle ? sectionsFromRows(content.bundle.slides, content.concepts) : []),
    [content.bundle, content.concepts],
  );
  const concepts = useMemo(() => spineConcepts(sections, lesson?.concepts ?? []), [sections, lesson]);
  const pages = useMemo(() => materialPagesFrom(sections), [sections]);

  const [studio, setStudio] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [companion, setCompanion] = useState<CompanionState | null>(null);
  const [bench, setBench] = useState<'practice' | null>(null);
  const [quote, setQuote] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnId = useRef(0);
  const mintTurnId = useCallback(() => turnId.current++, []);
  const [noteTick, setNoteTick] = useState(0);
  const [accent, setAccent] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const foundNonce = useRef(0);
  const [sheetWidth, setSheetWidth] = useState(MAX_SHEET);

  /* The room follows the page a beat late; stills are kept per page. */
  const [roomPage, setRoomPage] = useState(1);
  const stills = useRef(new Map<number, string>());
  const [still, setStill] = useState<{ page: number; url: string } | null>(null);
  const onStill = useCallback((page: number, url: string) => {
    stills.current.set(page, url);
    setStill((s) => (s && s.page === page ? s : { page, url }));
  }, []);
  useEffect(() => {
    const url = stills.current.get(roomPage);
    if (url) setStill({ page: roomPage, url });
  }, [roomPage]);

  const pdfRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (anchor || sections.length === 0) return;
    setAnchor({ conceptId: sections[0].conceptId, page: sections[0].blocks[0].page });
  }, [anchor, sections]);

  useEffect(() => {
    if (!anchor) return;
    const t = setTimeout(() => setRoomPage(anchor.page), 240);
    return () => clearTimeout(t);
  }, [anchor]);

  /* The page fits the window; the window is measured, not assumed. */
  useEffect(() => {
    const el = pdfRef.current;
    if (!el) return;
    const read = () => setSheetWidth(Math.max(280, Math.min(MAX_SHEET, el.clientWidth - 48)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content.bundle]);

  /* Reset when the Lesson changes — React's documented way, during render. */
  const [readingId, setReadingId] = useState(lessonId);
  if (readingId !== lessonId) {
    setReadingId(lessonId);
    setStudio(false);
    setAnchor(null);
    setEngaged(false);
    setCompanion(null);
    setBench(null);
    setQuote(undefined);
    setTurns([]);
    setAccent(null);
    setFound(null);
  }

  const engage = useCallback(() => setEngaged(true), []);
  const openStudio = useCallback(() => {
    engage();
    setBench(null);
    setStudio(true);
  }, [engage]);
  const closeStudio = useCallback(() => {
    setStudio(false);
    setCompanion(null);
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
    setStudio(false);
  }, []);

  /* The document's scroll is the anchor. */
  const onPdfPage = useCallback(
    (page: number) => {
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
      const el = pdfRef.current;
      if (el) scrollToPdfPage(el, page, anchorLine, reduce ? 'auto' : 'smooth');
    },
    [sections, engage, reduce],
  );

  /*
   * The same sentence, found on the other side. Tried over a couple of
   * seconds of frames: the studio may still be mounting, or the page still
   * painting its text layer. Words outside the window are brought to the
   * anchor line first.
   */
  const findOn = useCallback((where: 'pdf' | 'text', text: string) => {
    const nonce = ++foundNonce.current;
    let tries = 0;
    const tick = () => {
      if (foundNonce.current !== nonce) return;
      const el = (where === 'pdf' ? pdfRef : textRef).current;
      const range = el ? findRange(el, text) : null;
      if (!range) {
        if (++tries < 150) requestAnimationFrame(tick);
        return;
      }
      let rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
      if (rects.length === 0) return;
      const first = rects[0];
      if (el && (first.top < 80 || first.bottom > window.innerHeight - 80)) {
        el.scrollBy({ top: first.top - anchorY(), behavior: 'auto' });
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

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.lessonFaces} motionKey={`faces-${lessonId}`}>
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
        <SpacesError what="this Lesson" />
      </>,
    );
  if (!space || !lesson)
    return chrome(
      <NotFound
        what="Lesson"
        backTo={space ? `/v4/space/${space.id}` : '/v4/spaces'}
        backLabel={space ? `Back to ${space.name}` : 'Back to Spaces'}
      />,
    );

  const back = `/v4/space/${space.id}/lesson/${lesson.id}`;

  if (!content.bundle || !content.pdfUrl || sections.length === 0 || !anchor)
    return chrome(
      <>
        <ReaderExit to={back} />
        <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 pt-14 text-center">
          <p className="mb-2 text-[17px] font-semibold">Nothing to read yet</p>
          <p className="mb-7 max-w-[46ch] text-[14.5px] leading-relaxed text-quiet">
            {lesson.title} has its ideas and its practice, but no Material and no text yet.
          </p>
          <Link
            to={back}
            className="console-focusable inline-flex h-11 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
          >
            Back to the Lesson
          </Link>
        </div>
      </>,
    );

  const myNotes = noteTick >= 0 ? notesForLesson(lesson.id) : [];
  const section = sections.find((s) => s.conceptId === anchor.conceptId) ?? sections[0];
  const lastSection = sections[sections.length - 1];
  const pagerShowing = !bench && !studio && anchor.conceptId === lastSection.conceptId;

  const landable = (c: TutorCitation) =>
    (c.conceptId !== undefined && sections.some((s) => s.conceptId === c.conceptId)) ||
    (c.materialPage !== undefined && pages.some((p) => p.page === c.materialPage));

  const openTutor = (title: string, page: number) => {
    openStudio();
    setCompanion({ kind: 'tutor', title, page });
  };
  const openNotes = (page: number) => {
    openStudio();
    setCompanion({ kind: 'notes', title: `Notes · ${lesson.title}`, page });
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
        placeholder="Private to you, and gathered in your Library."
        onSave={(body) => {
          addNote({ lessonId: lesson.id, body, lessonTitle: lesson.title, spaceId: space.id, spaceName: space.name });
          setNoteTick((t) => t + 1);
        }}
      />
      {myNotes.length === 0 && (
        <p className="px-1 text-[13px] text-faint">Nothing yet. Notes are private, and only you ever see them.</p>
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
          Practise this idea
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
          Practise what you just read
        </button>
      )}
      <Link
        to={back}
        className="console-focusable inline-flex h-12 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
      >
        Back to the Lesson
      </Link>
    </div>
  );

  const docked = studio && panel;

  return chrome(
    <div
      className="relative h-[100dvh] overflow-hidden"
      style={accent ? ({ '--reader-accent': accent } as React.CSSProperties) : undefined}
    >
      <Room still={still?.url ?? null} page={still?.page ?? roomPage} />
      <RoomStill pdfUrl={content.pdfUrl} page={roomPage} onStill={onStill} />
      <FoundLine found={found} />

      {/* Words on the page. */}
      <SelectionAsk
        articleRef={pdfRef}
        also={{
          label: 'Read this',
          onPress: (text) => {
            openStudio();
            findOn('text', text);
          },
        }}
        onAsk={(text) => {
          setQuote(text);
          openTutor(text.length > 60 ? `${text.slice(0, 57)}…` : text, pageOfSelection() ?? anchor.page);
        }}
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
          label: 'Show page',
          onPress: (text) => {
            goToPage(pageOfSelection() ?? anchor.page);
            findOn('pdf', text);
          },
        }}
        onAsk={(text) => {
          setQuote(text);
          openTutor(text.length > 60 ? `${text.slice(0, 57)}…` : text, pageOfSelection() ?? anchor.page);
        }}
        onSaveNote={(text) => {
          addNote({ lessonId: lesson.id, body: `“${text}”`, lessonTitle: lesson.title, spaceId: space.id, spaceName: space.name });
          setNoteTick((t) => t + 1);
          openNotes(pageOfSelection() ?? anchor.page);
        }}
      />

      <ReaderExit to={back} />

      <Spine
        concepts={concepts}
        currentId={anchor.conceptId}
        right={docked ? STUDIO_WIDTH + 12 : 12}
        onJump={(id) => {
          const p = firstPageOf(id, sections);
          if (p !== null) goToPage(p);
        }}
      />

      {/*
        The document. It steps aside by half the studio's width when the
        studio is a panel, so the pages stay uncovered — a transform, never a
        change of width.
      */}
      <motion.div
        initial={false}
        animate={{ x: docked ? -STUDIO_WIDTH / 2 : 0 }}
        transition={{ duration: reduce ? 0.2 : timing.card }}
        className="absolute inset-0"
      >
        <PdfScroll
          file={content.pdfUrl}
          width={sheetWidth}
          anchorLine={anchorLine}
          onPage={onPdfPage}
          onFirstRender={(canvas) => setAccent(sampleAccent(canvas))}
          scrollRef={pdfRef}
          className="h-full overflow-y-auto"
        />
      </motion.div>

      {/*
        The page line: where you are, and the way into the studio. The
        Concept's name is the press; the page number is a readout.
      */}
      <div className="fixed bottom-4 left-4 z-30 flex items-center gap-2 text-[12.5px] tabular-nums text-quiet">
        <span>Page {anchor.page}</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={() => (studio ? closeStudio() : openStudio())}
          aria-pressed={studio}
          className="console-focusable rounded px-1 py-0.5 font-medium text-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))] underline-offset-2 hover:underline"
        >
          {section.name}
        </button>
        {!engaged && (
          <span className="ml-3 hidden text-faint sm:inline">
            Select words on the page to ask about them, or to read them as text.
          </span>
        )}
      </div>

      <Studio
        open={studio && !bench}
        where={`${section.name} · Page ${anchor.page}`}
        onClose={escapeStudio}
        panel={panel}
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
            setQuote(tex);
            openTutor('This formula', anchor.page);
          }}
          wide={false}
          companion={companion ? { page: companion.page, node: companionNode } : null}
          footer={footer}
          scrollRef={textRef}
          articleClassName="px-6 pb-[40vh] pt-8"
        />
      </Studio>

      <PracticePlane
        open={bench === 'practice'}
        lessonTitle={lesson.title}
        questions={practiceForLesson(lesson.id)}
        onClose={closeBench}
      />

      {pagerShowing && <LessonPager spaceId={space.id} prev={prev} next={next} />}
    </div>,
  );
}
