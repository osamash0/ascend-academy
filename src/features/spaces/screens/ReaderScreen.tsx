import { useCallback, useMemo, useRef, useState } from 'react';
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
import { ReaderExit, ReaderHeader } from '../components/reader/ReaderHeader';
import type { RailTab, ReaderView } from '../components/reader/ReaderHeader';
import { ReaderRail } from '../components/reader/ReaderRail';
import { SelectionAsk } from '../components/reader/SelectionAsk';
import { SourceView } from '../components/reader/SourceView';
import { TutorPanel } from '../components/reader/TutorPanel';
import type { Turn } from '../components/reader/TutorPanel';

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
 *
 * One clamp per view, and the second one is why. The first version had a
 * single constant derived from the article and put it on the wrapper — which
 * wraps both views. Read was correct; Source is a wider column, so the clamp
 * let it travel further left than its own edge allowed. Measured at 1024px:
 * the page card sat at -60 and its heading at -20, and because content left of
 * the origin creates no scroll area, the first character of every line was not
 * off-screen but *unreachable*. Negative from about 900 to 1244, which is most
 * laptops.
 *
 * The rule is identical for both views and only the width differs: clamp to
 * the distance from the page edge to the first character, which is the
 * column's content box — its `max-w` less both sides of its `px-6`. Read is
 * 672 − 48 = 624; Source is 860 − 48 = 812.
 *
 * The tempting wrong answer is the page card's own 760, and it was tried: the
 * card is centred inside the column, so clamping to it lands the card at
 * exactly 0 and pushes the *heading above it* — which is full column width —
 * to -26. It looked right in the one place the eye goes first. Clamp to the
 * widest thing in the column, not the most prominent one.
 *
 * Both numbers are pinned by tests against the classes they come from, because
 * a constant that quietly stops matching its class is how this bug got here.
 */
/*
 * Written out in full, twice, and it has to be. The first attempt built these
 * from `dockShift(edge)` — one template literal, no repetition, obviously
 * nicer. It also silently produced no CSS at all: Tailwind scans source text
 * for class names, so a class assembled at runtime is a class it never sees,
 * and both wrappers carried a rule that had never been generated. The class
 * lists in the DOM were correct and `getComputedStyle` said `transform: none`.
 *
 * The jsdom guards below did not catch it either, because they compare class
 * strings and there is no stylesheet behind them. Only the browser saw it.
 */
const DOCKED_READ =
  '[@media(min-width:900px)]:translate-x-[calc(-1*min(192px,(100%_-_624px)/2))]';
const DOCKED_SOURCE =
  '[@media(min-width:900px)]:translate-x-[calc(-1*min(192px,(100%_-_812px)/2))]';

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
   * Written by the selection popover, read by the tutor, and cleared by the
   * tutor the moment it is asked with — the clearing half is the half that
   * gets forgotten, and a quote that survived being asked about would ride
   * along on the next question too.
   */
  const [quote, setQuote] = useState<string | undefined>(undefined);

  /*
   * The article, so a selection can be told from every other selectable thing
   * on the screen.
   *
   * A ref rather than a query, because "inside the prose" is a fact about a
   * particular element and `querySelector('article')` would silently start
   * meaning something else the day the reader grows a second one. Null on the
   * branches that render no article at all, which is exactly right: there is
   * nothing to select from on a Lesson with no text.
   */
  const articleRef = useRef<HTMLElement>(null);

  /*
   * The tutor's thread, up here rather than inside the panel that renders it.
   *
   * The rail shows one companion at a time and unmounts the other, and it
   * unmounts both when it closes. A thread owned by `TutorPanel` therefore
   * died the moment you glanced at your own notes and again every time you
   * shut the rail — measured, both paths — which is a conversation lost to the
   * most ordinary thing a two-tab rail invites anybody to do.
   *
   * It sits beside the view, the rail and the page for the same reason those
   * do: it is *where you are* in this Lesson, and the rail is chrome that owns
   * nothing. Keeping the fix here rather than in `ReaderRail` is what lets the
   * rail go on knowing nothing about a tutor — the alternative, mounting both
   * panels and hiding one, would have taught it what it was hiding and still
   * lost the thread on close.
   *
   * The counter comes with it. Ids have to be unique across the whole thread's
   * life, and one restarting with the panel would hand a new question the id
   * of a turn already in the list — which is what the resolution handler
   * matches on, so an answer would land under somebody else's question.
   */
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnId = useRef(0);
  const mintTurnId = useCallback(() => turnId.current++, []);

  /*
   * Reset the lot when the Lesson changes.
   *
   * Defensive against a navigation the assembled app does not currently
   * produce, and worth saying plainly rather than claiming otherwise:
   * `LessonPager` links to the Lesson *overview*, which is a different route,
   * so React Router unmounts this screen and every value above resets by
   * itself. Only a move from one `/read` to another — same route, different
   * param — keeps the screen alive, and nothing links that way today.
   *
   * It is kept, and the tutor thread is what makes it worth keeping. That
   * thread moved up here so it could survive the rail closing, which makes it
   * also the state most able to outlive a Lesson the day such a link exists.
   * Page 9 of one Material opening as page 9 of the next is the cheap version
   * of the same mistake; a thread answering about Normalization under the next
   * Lesson's title is the expensive one.
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
    setTurns([]);
  }

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.lessonReader} motionKey={`read-${lessonId}`}>
      {body}
    </Scene>
  );

  /*
   * Where the exit points before there is a Lesson to point at.
   *
   * The URL always knows, even when the load does not: the Lesson overview is
   * where this reader was opened from, and if the id in the URL is wrong that
   * screen says so properly rather than hanging. Falling back to the Spaces
   * list covers a route with no params, which the router does not currently
   * produce.
   */
  const exitTo =
    spaceId && lessonId ? `/v4/space/${spaceId}/lesson/${lessonId}` : '/v4/spaces';

  /*
   * A skeleton and a failure both keep the bare chrome RULING F4 gave them —
   * and both now carry the exit, because they had none at all.
   *
   * `SpacesError` offers "Try again", which reloads; `DetailSkeleton` offers
   * nothing, and `?mock=loading` never resolves. On a surface with no top bar
   * and no bottom nav that left two of the reader's four branches with no way
   * out of the product's own chrome, under a guard named "always offers a way
   * out" that was only ever looking at the branch that reads.
   *
   * The exit is a sibling rather than something passed into those components:
   * they are shared by a dozen screens that have their own chrome, and the
   * reader is the one that took its chrome off.
   */
  if (screenState === 'loading')
    return chrome(
      <>
        <ReaderExit to={exitTo} />
        <DetailSkeleton />
      </>,
    );
  if (screenState === 'error')
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
   * What to do when the reading is done — under both views, not just the one
   * that happened to be built first.
   *
   * The Read view has had this since the beginning: practice is the obvious
   * next move and it is a Lesson away rather than a screen away. The Material
   * had nothing, which was invisible while every Material sat behind a text
   * you could toggle back to — and a dead end on the Lesson where it does
   * not. `l-s-dbs-10` has a file, no prose, no practice bank and no Lesson
   * after it: the reader could open it and find the header's X the only live
   * control on the screen. That is the dead end the Source view was built to
   * remove, at the far end of the same screen.
   *
   * Two independent conditions rather than a branch per Lesson shape. The
   * practice link appears wherever there is practice. The way back appears
   * wherever there is no prose to return to — with a text, the Read/Source
   * segment is already that, and a second copy of it under the card would be
   * chrome repeating itself.
   *
   * Rendered as nothing at all when neither applies, because an empty rule
   * line under the last paragraph is a promise of something below it.
   */
  const practiceLink = lesson.practiceCount > 0 && (
    <PressableLink
      to={`/v4/space/${space.id}/lesson/${lesson.id}/practice`}
      className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14.5px] font-semibold text-slate-900"
    >
      <ListChecks aria-hidden className="h-4 w-4" />
      Practise what you just read
    </PressableLink>
  );
  const backLink = passages.length === 0 && (
    <Link
      to={back}
      className="console-focusable inline-flex h-12 items-center rounded-full border border-white/12 bg-white/[0.04] px-6 text-[14px] font-medium"
    >
      Back to the Lesson
    </Link>
  );
  const whatNext =
    practiceLink || backLink ? (
      <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-8">
        {practiceLink}
        {backLink}
      </div>
    ) : null;

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
      turns={turns}
      onTurnsChange={setTurns}
      mintTurnId={mintTurnId}
    />
  );

  /*
   * Selecting a sentence, and the two things it can become.
   *
   * Both are the panels the header already opens — nothing new is reachable
   * this way, only reachable *from the sentence*. That is what makes the
   * popover safe to leave as a pointer affordance: a keyboard has the same two
   * doors, one Tab away, and always has.
   *
   * The note's body is the quote and nothing else. The brief asks for a blank
   * line after it, and there is deliberately none: `addNote` trims the body,
   * because a store that silently keeps blank notes leaves rubbish in the one
   * place that is entirely yours — so a trailing newline is unrepresentable
   * here, and writing one anyway would be a line of code that provably does
   * nothing. Loosening that guard to buy a cosmetic gutter is the wrong trade.
   * What the rule is actually about survives: the quote lives *in the body*,
   * not in a new field and not in an anchor, and the quotation marks are what
   * say it is not your own writing.
   */
  const selectionAsk = (
    <SelectionAsk
      articleRef={articleRef}
      onAsk={(text) => {
        setQuote(text);
        setRailTab('tutor');
      }}
      onSaveNote={(text) => {
        addNote({
          lessonId: lesson.id,
          body: `“${text}”`,
          lessonTitle: lesson.title,
          spaceId: space.id,
          spaceName: space.name,
        });
        setNoteTick((t) => t + 1);
        setRailTab('notes');
      }}
    />
  );

  /*
   * Header, body, rail — for every shape of Lesson below.
   *
   * The rail hangs off the composition rather than off one branch because the
   * two companions are about the *Lesson*, not about which of its two views
   * happens to be showing. Notes on an unwritten Lesson are exactly the notes
   * somebody would want.
   *
   * The popover comes first, and the order is the whole of its keyboard story.
   * It is `position: fixed`, so nothing about the page moves either way; what
   * DOM order buys is the tab order. After a selection, focus is on the body,
   * and the next Tab goes to the first focusable thing in the document — which
   * is this, when it is showing, and the header's exit when it is not. It
   * renders nothing at all while there is no selection, so the reader's tab
   * order is untouched for everybody who never selects anything.
   *
   * It is also *outside* the docked wrapper, and that is load-bearing rather
   * than tidy: a CSS transform makes an element the containing block for its
   * `position: fixed` descendants, so a popover inside the wrapper would be
   * positioned against the shifted column instead of the viewport, and would
   * drift by the dock's offset the moment the rail opened.
   */
  const readerChrome = (
    body: React.ReactNode,
    docked: string = DOCKED_READ,
    /*
     * Fixed chrome that belongs to a branch, kept out of the wrapper on
     * purpose — see the pager below.
     */
    floating: React.ReactNode = null,
  ) =>
    chrome(
      <>
        {selectionAsk}
        {header}
        {/*
          The clamp is the caller's, because only the caller knows how wide the
          column it is passing actually is. Defaulting to the Read clamp is
          safe for the narrower branches — a larger edge constant yields a
          smaller shift, so the unwritten column can only move less than it is
          allowed to, never more.
        */}
        <div className={cn(railTab !== null && docked)}>{body}</div>
        {floating}
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
      <div className="mx-auto max-w-[860px] px-6 pb-32 pt-24" data-source-column>
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
        {whatNext}
      </div>,
      DOCKED_SOURCE,
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
      <article ref={articleRef} className="mx-auto max-w-2xl px-6 pb-32 pt-28">
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

        {whatNext}
      </article>
    </>,
    DOCKED_READ,
    /*
     * The pager, outside the article and outside the wrapper the dock moves.
     *
     * It is `position: fixed` chrome that happened to be written inside the
     * column, and a transformed ancestor becomes the containing block for its
     * fixed descendants — so docking the column for the rail dragged the pager
     * with it. Measured at 1016px with the rail out: the previous card sat at
     * −272 to −32, entirely off the left of the window, and content left of the
     * origin creates no scroll area, so it was unreachable rather than merely
     * out of sight.
     *
     * Being a sibling fixes the left card. The right one needed the other half
     * — `companionOpen` — because the card was inside the rail's rectangle with
     * the dock switched off too: `inset-x-0` spans the window and the rail owns
     * the last 384px of it. The pager now spans the page minus the companion,
     * so both cards peek from the edge of what is actually visible.
     *
     * The pager walks published Lessons only — Rule 1 holds here too.
     */
    <LessonPager
      spaceId={space.id}
      prev={prev}
      next={next}
      companionOpen={railTab !== null}
    />,
  );
}
