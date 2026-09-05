import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { spaceById } from '../mocks/spaces';
import { adjacentLessons, visibleLesson } from '../mocks/lessons';
import { addNote, deleteNote, notesForLesson, updateNote } from '../mocks/notes';
import { Scene, SURFACES } from '../components/Scene';
import { LessonPager } from '../components/LessonPager';
import { NoteEditor } from '../components/NoteEditor';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { useScreenState } from '../data/useSpaces';
import { PressableLink } from '../components/Pressable';
import { ReaderHeader } from '../components/reader/ReaderHeader';
import type { RailTab, ReaderView } from '../components/reader/ReaderHeader';
import { ReaderRail } from '../components/reader/ReaderRail';
import { SourceView } from '../components/reader/SourceView';
import { TutorPanel } from '../components/reader/TutorPanel';

/**
 * Reading a Lesson.
 *
 * The surface the whole design has been pointing at, and the last one built.
 * Everything else in v4 is a way of choosing what to read; this is the reading.
 *
 * A **focus** surface, by the same rule as Practice: the console texture comes
 * off, the top bar goes with it, and what is left is a column of text and a
 * way out. `Scene` enforces that by construction — the surface is a type, not
 * a convention.
 *
 * Three decisions worth naming:
 *
 *   • **A passage per Concept.** The reader walks the same objects the map
 *     lights, rather than being a parallel structure that happens to sit in
 *     the same Lesson. One idea, one heading, one place it is explained.
 *   • **Measured, not assumed.** The target is 60–70 characters a line, and
 *     the class does not say what it is: `ch` is the width of "0", so `58ch`
 *     renders 73 characters. Worse, the first tightening changed nothing —
 *     the article's `max-w-2xl` was binding and the `ch` cap never applied.
 *     It is `52ch` ≈ 66, checked in a browser. A reader is the one screen
 *     where getting the measure wrong is unmissable.
 *   • **It changes no progress.** Marking a Concept read on scroll would be
 *     inventing a progression rule, and Doc 1 locks progression to XP awarded
 *     by the engine. What reading does to the map is an open question, and an
 *     open question is not something a screen should quietly answer.
 *
 * All three survive the chrome that has since grown around the column. The
 * exit and the breadcrumb used to sit *inside* the article and scrolled away
 * with it; they now live in a fixed `ReaderHeader`, which is also where the
 * things the reader can summon hang from. The column itself is untouched by
 * that move except for the top padding it needs to clear the bar — with the
 * rail closed it is the same 52ch inside the same `max-w-2xl` it has always
 * been, which is the "summoned, never squatting" rule stated as a diff.
 *
 * The companions hang off the same bar. They are *summoned*: closed, there is
 * no rail in the document at all, and the column is byte-for-byte the column
 * it was before any of this existed. Open, the wrapper around the column steps
 * aside — the column itself never learns that anything happened to it, which
 * is the only way that rule can survive somebody editing this file later.
 *
 * There are now two views of one Lesson: the prose, and the Material it was
 * written from. Which of the four shapes a Lesson has is derived rather than
 * remembered — see `effectiveView` below. The important one is the third: a
 * Lesson with a file and no text used to render "Not written yet" while
 * holding the thing you came to read. It opens in the Material instead, and
 * the dead end is gone without anybody having to write prose to remove it.
 */

/**
 * The dock, as one class on a wrapper the article knows nothing about.
 *
 * "Summoned, never squatting" is a rule about the *column*, so the column may
 * not be the thing that moves: its class list has to be byte-identical open
 * and closed. The wrapper around it takes the shift instead.
 *
 * It is a shift and never a squeeze. Narrowing the wrapper — `mr-96`, the
 * obvious first idea — reads correctly down to about 1056px and then starts
 * eating the measure: at 900px the column would come out 460px of text wide
 * against a 555px line, which is the one thing the reader is not allowed to
 * lose.
 *
 * The number is the rail's half-width, so a column centred in the page ends up
 * centred in what is left of it. It is clamped by the room actually available
 * on the left — `(100% - 624px)/2` is the distance from the page edge to the
 * first character — because a flat 192px pushes the first few characters off
 * the left edge of a 900px window, which is a worse failure than the one it
 * fixes. Between 900 and 939px neither is fully avoidable, and the arithmetic
 * says why: 384 of rail plus 555 of measure is 939, and a 900px window offers
 * 892. The two numbers this reader was given are simply inconsistent down
 * there, so the clamp spends the shortfall on the right — the last few
 * characters of the longest lines pass under the rail's edge — rather than on
 * the left, where they would be cut off the page entirely. Under 900 the rail
 * stops docking and overlays instead.
 *
 * `100%` rather than `100vw`, and it was measured: a translate percentage
 * resolves against this wrapper, which is the page, while `100vw` includes the
 * scrollbar the page does not have. At 900px that eight-pixel lie became four
 * pixels of the first character column hanging off the left edge — the exact
 * failure the clamp is here to prevent, reintroduced by the unit.
 *
 * No transition on it, deliberately: `transition-transform` is banned across
 * this namespace because it animates past `prefers-reduced-motion`, and the
 * honest alternative — Motion — cannot interpolate a `calc` of percentages.
 * So the column steps aside rather than gliding.
 */
const DOCKED = '[@media(min-width:900px)]:translate-x-[calc(-1*min(192px,(100%_-_624px)/2))]';

export default function ReaderScreen() {
  const screenState = useScreenState();
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const space = spaceId ? spaceById(spaceId) : undefined;
  const lesson = useMemo(
    () => (space && lessonId ? visibleLesson(space, lessonId) : undefined),
    [space, lessonId],
  );

  /*
   * Which of the two views of this Lesson is showing, and which companion —
   * if any — is out. Both are screen state rather than URL state: they are
   * how you are reading right now, not what you are reading, and a rail that
   * survived a link would be squatting on the next Lesson's column too.
   *
   * `railTab === null` is the closed rail. One nullable value rather than an
   * `open` flag beside a `tab`, because those two can disagree and this
   * cannot.
   */
  const [view, setView] = useState<ReaderView>('read');
  const [railTab, setRailTab] = useState<RailTab | null>(null);
  const toggleRail = (tab: RailTab) => setRailTab((open) => (open === tab ? null : tab));
  /*
   * Stable, because the rail listens for Escape on the document and would
   * otherwise tear the listener down and put it back on every render of the
   * screen — including every keystroke into a note.
   */
  const closeRail = useCallback(() => setRailTab(null), []);

  /*
   * One tick per write, the same shape `LessonScreen` uses: the note store
   * lives outside React, so nothing else would tell this list it had changed.
   */
  const [noteTick, setNoteTick] = useState(0);
  const myNotes = useMemo(
    () => (lessonId ? notesForLesson(lessonId) : []),
    [lessonId, noteTick],
  );

  /*
   * Which page of the Material is showing — held here, beside the view and the
   * rail, rather than inside `SourceView`.
   *
   * All three are the same kind of thing: where you are in this Lesson, across
   * both views of it. The tutor cites a page, and a citation has to be able to
   * turn the page from outside the Source view; internal state would leave it
   * reaching for a ref or remounting the component with a new `key`, which is
   * a workaround for having put the state in the wrong place.
   */
  const [page, setPage] = useState(1);

  /*
   * A sentence carried out of the text and into the tutor's composer.
   *
   * Nothing writes to it yet — selecting a sentence in the article is what
   * will, and that popover is not built. It is real state rather than a no-op
   * handed to the panel because the clearing half is the half that gets
   * forgotten: a quote that survived being asked about would ride along on
   * the next question too.
   */
  const [quote, setQuote] = useState<string | undefined>(undefined);

  /*
   * Reset the lot when the Lesson changes.
   *
   * The pager navigates between Lessons without unmounting this screen — same
   * route, different param — so nothing resets on its own. Without this, page
   * 9 of one Material opens as page 9 of the next, and a rail summoned here
   * would be squatting on the next Lesson's column, which the focus-surface
   * rule forbids in as many words.
   *
   * Set during render rather than in an effect: React's documented way to
   * adjust state when a prop changes, and it avoids the frame where the wrong
   * page is on screen.
   */
  const [readingId, setReadingId] = useState(lessonId);
  if (readingId !== lessonId) {
    setReadingId(lessonId);
    setView('read');
    setRailTab(null);
    setPage(1);
    setQuote(undefined);
  }

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.lessonReader} motionKey={`read-${lessonId}`}>
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<DetailSkeleton />);
  if (screenState === 'error') return chrome(<SpacesError what="this Lesson" />);

  if (!space || !lesson)
    return chrome(
      <NotFound
        what="Lesson"
        backTo={space ? `/v4/space/${space.id}` : '/v4/spaces'}
        backLabel={space ? `Back to ${space.name}` : 'Back to Spaces'}
      />,
    );

  const back = `/v4/space/${space.id}/lesson/${lesson.id}`;
  const { prev, next } = adjacentLessons(space.id, lesson.id);
  const passages = lesson.passages ?? [];
  /*
   * `material === null` is the deleted source file, and it takes the pages
   * with it — which is the reason they hang off the Material and not the
   * Lesson. There is nothing to show and so nothing to toggle to.
   */
  const pages = lesson.material?.pages ?? [];

  /*
   * Four shapes, one derivation. A Lesson has prose, a Material with pages,
   * both, or neither — and only *both* leaves anything for the reader to
   * choose, so the stored `view` is consulted only then. Deriving it rather
   * than trusting the state means a Lesson with one view cannot be left
   * showing the other by whatever the last Lesson was set to.
   */
  const showToggle = passages.length > 0 && pages.length > 0;
  const effectiveView: ReaderView = showToggle ? view : passages.length > 0 ? 'read' : 'source';

  /*
   * The sync line's other half: a page names its Concept, and pressing that
   * name lands you on the passage explaining it.
   *
   * The scroll happens a frame later because the passage is not in the
   * document at the moment `setView` is called — React has not re-rendered
   * yet, so `getElementById` would find nothing and the jump would silently
   * do nothing at all.
   *
   * `behavior` is stated rather than left to the stylesheet. `index.css` sets
   * `scroll-behavior: smooth` on `html` for the whole app, and that CSS
   * property does not consult the operating system — so leaving it implicit
   * animates a 900px scroll at somebody who has asked for less motion. The
   * `MotionConfig` above only governs Motion, and this is the browser.
   *
   * `scroll-mt-24` on the section is what keeps the heading you jumped to
   * clear of the fixed header, which would otherwise cover it exactly.
   */
  const jumpToPassage = (conceptId: string) => {
    setView('read');
    requestAnimationFrame(() => {
      document.getElementById(`passage-${conceptId}`)?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    });
  };

  /*
   * The header exists wherever a Lesson does — including the unwritten one
   * below, which is a state of this Lesson rather than a different screen.
   * The three branches above it are not: a skeleton, a failure and a missing
   * Lesson have no Space name to show, no ideas to count and nothing to
   * summon a tutor about, so they keep the bare chrome they have always had.
   */
  const header = (
    <ReaderHeader
      spaceName={space.name}
      lessonOrder={lesson.order}
      backTo={back}
      concepts={lesson.concepts}
      view={effectiveView}
      onViewChange={setView}
      showToggle={showToggle}
      railOpen={railTab !== null}
      railTab={railTab}
      onRailToggle={toggleRail}
    />
  );

  /*
   * Notes, in the rail, written against the same store Library reads.
   *
   * Composed here rather than inside `ReaderRail` for the same reason the
   * tutor will be: the rail owns chrome, and a panel that knew which Lesson it
   * was anchored to would make the rail a thing you have to edit to add a
   * third companion.
   */
  const notesPanel = (
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

      {/*
        Remounted on every write — the key carries the tick — so the composer
        empties itself after a save instead of holding the note you just wrote.
      */}
      <NoteEditor
        key={`new-${noteTick}`}
        placeholder="Private to you, and gathered in your Library."
        onSave={(body) => {
          addNote({
            lessonId: lesson.id,
            body,
            lessonTitle: lesson.title,
            spaceId: space.id,
            spaceName: space.name,
          });
          setNoteTick((t) => t + 1);
        }}
      />

      {myNotes.length === 0 && (
        <p className="px-1 text-[13px] text-faint">
          Nothing yet. Notes are private, and only you ever see them.
        </p>
      )}
    </div>
  );

  /*
   * The tutor, in the other half of the rail.
   *
   * It arrives as a node for the same reason the notes do, and the payoff is
   * visible here: the rail did not have to change to gain a second companion.
   *
   * Its two citation handlers are the two jumps this screen already knows how
   * to make. `onCiteConcept` **is** the sync line's jump rather than a second
   * copy of it — a citation and a page's "belongs to" line are one movement
   * ("take me to the passage explaining this"), and two implementations of it
   * would drift, with the untested one winning. `onCiteMaterial` is the same
   * movement in the other direction, and it is why the page number lives up
   * here beside the view: a chip has to be able to turn the page of a view
   * that is not even mounted yet.
   *
   * Grounding is the Space's setting, passed down rather than looked up: the
   * panel renders the marker or renders nothing, and it has no business
   * knowing what a Space is.
   */
  const tutorPanel = (
    <TutorPanel
      lesson={lesson}
      groundingEnabled={space.groundingEnabled}
      onCiteConcept={jumpToPassage}
      onCiteMaterial={(p) => {
        setPage(p);
        setView('source');
      }}
      pendingQuote={quote}
      onQuoteConsumed={() => setQuote(undefined)}
    />
  );

  /*
   * Header, body, rail — for every shape of Lesson below.
   *
   * The rail hangs off the composition rather than off one branch because the
   * two companions are about the *Lesson*, not about which of its two views
   * happens to be showing. Notes on an unwritten Lesson are exactly the notes
   * somebody would want.
   */
  const readerChrome = (body: React.ReactNode) =>
    chrome(
      <>
        {header}
        <div className={cn(railTab !== null && DOCKED)}>{body}</div>
        <ReaderRail
          open={railTab !== null}
          /* Meaningless while closed — the rail renders nothing at all then. */
          tab={railTab ?? 'notes'}
          onTabChange={setRailTab}
          onClose={closeRail}
          tutor={tutorPanel}
          notes={notesPanel}
        />
      </>,
    );

  /*
   * The Material, when there is one to show.
   *
   * Its own measure: a page card is a landscape thing and reads badly forced
   * into the article's 52ch, which is a column sized for running prose. Two
   * views, two right answers — the constraint is that the *article* keeps
   * its measure, not that everything shares it.
   *
   * No `LessonPager` here, deliberately, and it was tried. The pager binds ←
   * and → to the previous and next *Lesson*, and this view's own ‹ and › are
   * the previous and next *page* — so mounting it would leave one pair of
   * arrow keys meaning two things on one screen. It is the same absence the
   * unwritten branch below has always had, so nothing regresses; which of the
   * two the arrows should walk is a decision, not a drive-by.
   */
  if (pages.length > 0 && effectiveView === 'source') {
    return readerChrome(
      <div className="mx-auto max-w-[860px] px-6 pb-32 pt-24">
        <div className="mb-6">
          <h1 className="text-[15px] font-semibold">{lesson.title}</h1>
          <p className="mt-0.5 text-[12.5px] text-faint">
            The Material this Lesson was built from
          </p>
        </div>
        <SourceView
          pages={pages}
          concepts={lesson.concepts}
          page={page}
          onPageChange={setPage}
          /*
            No handler when there is no text to jump into. Passing one anyway
            made the sync line a button that called back, derived its way
            straight back to this view, and did nothing — which is the dead
            end this branch exists to remove, one line lower down.
          */
          onJumpToPassage={passages.length > 0 ? jumpToPassage : undefined}
        />
      </div>,
    );
  }

  /*
   * Written Lessons are the exception, not the rule, and the screen says which
   * one this is rather than rendering an empty column. Writing a Lesson is
   * content work; pretending otherwise would make the reader look finished
   * while testing nothing.
   *
   * This is now the *last* resort rather than the answer to "no passages": a
   * Lesson holding a Material opened here too, apologising for having nothing
   * while the file it was built from sat one branch above.
   */
  if (passages.length === 0) {
    return readerChrome(
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 pt-14 text-center">
        <p className="mb-2 text-[17px] font-semibold">Not written yet</p>
        <p className="mb-7 max-w-[46ch] text-[14.5px] leading-relaxed text-quiet">
          {lesson.title} has its ideas and its practice, but the text itself has not been
          built from the material yet.
        </p>
        <Link
          to={back}
          className="console-focusable inline-flex h-11 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
        >
          Back to the Lesson
        </Link>
      </div>,
    );
  }

  return readerChrome(
    <>
      {/*
        `pt-28` is the fixed header's 56px plus the 56px of air the old inline
        row left above the title. It is the only thing about this column the
        header changed: the width and the measure are exactly what they were.
      */}
      <article className="mx-auto max-w-2xl px-6 pb-32 pt-28">
        <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.02em]">{lesson.title}</h1>

        {/*
          The id is what the Source view's sync line aims at, and `scroll-mt-24`
          is what stops it landing under the fixed header — `scrollIntoView`
          puts the element's top edge at the viewport's top, which is 56px of
          backdrop-blurred bar, so the heading you jumped to would be the one
          thing you could not see.
        */}
        {passages.map((p) => (
          <section key={p.conceptId} id={`passage-${p.conceptId}`} className="mt-12 scroll-mt-24">
            <h2 className="mb-4 text-[20px] font-semibold tracking-[-0.01em]">{p.heading}</h2>
            {p.body.map((para, i) => (
              <p
                key={i}
                /*
                  52ch ≈ 66 characters a line, measured rather than assumed.
                  Two things had to be measured to land here. `ch` is the width
                  of "0", which is wider than average lowercase, so the number in
                  the class is not the number of characters — 58ch renders 73.
                  And the first attempt to tighten it changed nothing at all,
                  because the article's own `max-w-2xl` was the binding
                  constraint and the `ch` cap never applied.
                */
                className="mb-5 max-w-[52ch] text-[17px] leading-[1.75] text-foreground last:mb-0"
              >
                {para}
              </p>
            ))}
          </section>
        ))}

        {/* What to do when the reading is done. Practice is the obvious next
            move, and it is a Lesson away, not a screen away. */}
        {lesson.practiceCount > 0 && (
          <div className="mt-14 border-t border-white/[0.08] pt-8">
            <PressableLink
              to={`/v4/space/${space.id}/lesson/${lesson.id}/practice`}
              className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14.5px] font-semibold text-slate-900"
            >
              <ListChecks aria-hidden className="h-4 w-4" />
              Practise what you just read
            </PressableLink>
          </div>
        )}

        {/* The pager walks published Lessons only — Rule 1 holds here too. */}
        <div className="mt-12">
          <LessonPager spaceId={space.id} prev={prev} next={next} />
        </div>
      </article>
    </>,
  );
}
