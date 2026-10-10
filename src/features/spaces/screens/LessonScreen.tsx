import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Check, FileWarning, ListChecks, Play, Sparkles, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LaunchButton, gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import type { Concept, Lesson, Space } from '../types';
import { contributionsForLesson } from '../mocks/contributions';
import { visibleContributions } from '../mocks/engagement';
import { addNote, deleteNote, notesForLesson, updateNote } from '../mocks/notes';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { isLive, useReaderContent, useReaderLesson, useRehearsalHistory } from '../data/useReader';
import { lightIdeas } from '../components/course/light';
import { readTrail } from '../data/trail';
import { sectionsFromRows, spineConcepts } from '../components/reader/anchors';
import { LessonDeck } from '../components/lesson/LessonDeck';
import { IdeaExplorer, type IdeaEntry } from '../components/lesson/IdeaExplorer';
import { ToolShelf } from '../components/lesson/ToolShelf';
import { authoredFor, toolsFor } from '../mocks/explain';
import { ContributionCard } from '../components/ContributionCard';
import { NoteEditor } from '../components/NoteEditor';
import { LessonPager } from '../components/LessonPager';
import { AuthorLine, GroundingMarker, OriginBadge } from '../components/badges';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';

/**
 * A Lesson's own overview.
 *
 * The console pattern the product already uses, applied one level down: a
 * full-bleed key-art hero with a single launch action, then rows of everything
 * that belongs to this Lesson beneath it.
 *
 * This is a **browse** surface, not the reader. You are choosing what to do
 * with this Lesson — start it, practise it, read what members added. The reader
 * itself is a focus surface and stays plain; that split is the Scene rule.
 *
 * Everything Doc 1 attaches to a Lesson shows here and nowhere else has to
 * carry it: its Concepts, its practice set, the community section for this
 * anchor level, and your own private notes.
 */

const CONCEPT_STATE: Record<Concept['progress'], { label: string; cls: string }> = {
  cleared: { label: 'Cleared', cls: 'border-success/40 bg-success/10 text-success' },
  discovered: { label: 'Read', cls: 'border-white/15 bg-white/[0.05] text-quiet' },
  untouched: { label: 'Not yet', cls: 'border-white/10 bg-transparent text-faint' },
};

function Row({
  title,
  lede,
  count,
  children,
}: {
  title: string;
  lede?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <h2 className="text-[26px] font-medium tracking-[-0.02em]">
        {title}
        {count !== undefined && <span className="ml-2.5 text-quiet tabular-nums">{count}</span>}
      </h2>
      {lede && <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-quiet">{lede}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function LessonScreen() {
  const { spaceId, lessonId } = useParams<{ spaceId: string; lessonId: string }>();
  const navigate = useNavigate();
  /*
   * Demo ids read the mocks, a real course and lecture read the backend — the
   * same hooks the reader uses, so moving between the two costs nothing.
   * Rule 1 runs inside them (`visibleLesson`): a Member asking for a draft by
   * URL gets "not found", not the draft.
   */
  const reader = useReaderLesson(spaceId, lessonId);
  const space: Space | undefined = reader.space ?? undefined;
  const lesson: Lesson | undefined = reader.lesson ?? undefined;

  /*
   * One tick for every write on this screen. The note store and the moderation
   * store both live outside React, so nothing else would tell these lists they
   * had changed — and hiding or promoting a contribution changes which ones
   * belong here, which the card cannot re-filter for itself.
   */
  const [noteTick, setNoteTick] = useState(0);
  const content = useReaderContent(spaceId, lessonId);
  const live = isLive(spaceId, lessonId);
  const { history } = useRehearsalHistory(live ? spaceId : undefined);
  /* A real deck shows as one section until its ideas are grouped — that is a wait, not an idea. */
  const ideasPending = live && content.concepts.length === 1 && content.concepts[0].concept_id.startsWith('whole-');
  const [accent, setAccent] = useState<string | null>(null);
  /* Where you stopped in this deck, if you have read it here before (a real course only). */
  const mark = useMemo(() => (lessonId ? readTrail()[lessonId] : undefined), [lessonId]);

  const contributions = useMemo(
    () =>
      lesson && space
        ? // Hidden work is still visible to its author and to Owner/Editors.
          visibleContributions(contributionsForLesson(lesson.id), space.viewerRole)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lesson, space, noteTick],
  );
  const myNotes = useMemo(
    () => (lessonId ? notesForLesson(lessonId) : []),
    [lessonId, noteTick],
  );
  /** Published neighbours only — the pager never steps into a draft. */
  const { prev, next } = reader;

  const chrome = (body: React.ReactNode, gradientIndex = 0) => (
    <Scene
      surface={SURFACES.lessonOverview}
      status="progress"
      gradientIndex={gradientIndex}
      motionKey={lessonId}
      accent={accent}
    >
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  // Not found, not a failure — a bad id must not claim the connection dropped.
  // All four states, on every screen. `?mock=loading|error` used to be a
  // no-op here, so these two had never been seen.
  if (reader.state === 'loading') return chrome(<DetailSkeleton />);
  if (reader.state === 'error') return chrome(<SpacesError what="this Lesson" />);

  if (!space || !lesson)
    return chrome(
      <NotFound
        what="Lesson"
        backTo={space ? `/v4/space/${space.id}` : '/v4/spaces'}
        backLabel={space ? `Back to ${space.name}` : 'Back to Spaces'}
      />,
    );

  const Icon = topicIcon(lesson.title, lesson.id);
  const cleared = lesson.concepts.filter((c) => c.progress === 'cleared').length;
  const done = lesson.progress === 'done';
  // Resume where you stopped: the first idea not yet cleared, else the first.
  const firstConcept =
    lesson.concepts.find((c) => c.progress !== 'cleared') ?? lesson.concepts[0];

  /* The deck, read the way the reader reads it — sections per idea, in page order. */
  const sections =
    content.bundle ? sectionsFromRows(content.bundle.slides, content.concepts) : [];
  const pdfUrl = content.pdfUrl;
  const pageCount = content.bundle?.slides.length ?? 0;
  /*
   * An idea runs from its first page to the page before the next idea starts.
   * Its gist is the first thing Explain has *written* about it; failing that,
   * the first page title that says more than the Lesson's own name. Its
   * preview is that page — never the deck's title slide.
   */
  const ideas: IdeaEntry[] = spineConcepts(sections, lesson.concepts).map((c, i, all) => {
    const sec = sections.find((x) => x.conceptId === c.id)!;
    const nextFirst = i + 1 < all.length ? sections.find((x) => x.conceptId === all[i + 1].id)!.firstPage : pageCount + 1;
    const blocks = sec.blocks.filter((b) => b.page < nextFirst);
    const written = blocks.map((b) => ({ b, a: authoredFor(lesson.id, b.page) })).find((x) => x.a);
    const titled = blocks.find((b) => b.title && b.title !== lesson.title && b.page > 1);
    const pick = written?.b ?? titled ?? blocks[0] ?? sec.blocks[0];
    return {
      concept: c,
      firstPage: sec.firstPage,
      lastPage: Math.max(sec.firstPage, nextFirst - 1),
      previewPage: pick.page,
      gist: written?.a?.title ?? pick.title ?? c.name,
    };
  });
  const tools = toolsFor(lesson.id);
  const readerAt = (page: number, view?: 'explain') =>
    `/v4/space/${space.id}/lesson/${lesson.id}/faces?page=${page}${view ? `&view=${view}` : ''}`;
  const resumePage = ideas.find((i) => i.concept.id === firstConcept?.id)?.firstPage ?? 1;

  const start = () =>
    pdfUrl && sections.length
      ? navigate(readerAt(mark && mark.page > 1 ? mark.page : lesson.percentComplete > 0 ? resumePage : 1))
      : lesson.passages?.length
        ? navigate(`/v4/space/${space.id}/lesson/${lesson.id}/read`)
        : firstConcept
          ? navigate(`/v4/space/${space.id}/concept/${firstConcept.id}`)
          : navigate(`/v4/space/${space.id}/lesson/${lesson.id}/practice`);
  const startLabel =
    mark && mark.page > 1 && pdfUrl
      ? `Continue at page ${mark.page}`
      : done
        ? 'Review'
        : lesson.percentComplete > 0
          ? 'Continue'
          : 'Start reading';

  return chrome(
    <div
      className="relative pb-36"
      style={accent ? ({ '--lesson-accent': accent, '--reader-accent': accent } as React.CSSProperties) : undefined}
    >
      {/* The ground is the stage's black, top bar included (see Scene). A
          skylight in the deck's colour starts *behind* the bar, so the bar
          and the page are lit by the same light instead of meeting at a seam. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[72px] left-1/2 h-[420px] w-screen -translate-x-1/2"
        style={{
          background: `radial-gradient(55% 70% at 50% 0%, color-mix(in srgb, ${accent ?? 'hsl(var(--secondary))'} 14%, transparent), transparent 72%)`,
        }}
      />

      {/* ── The deck, lit in its own colour ── */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute left-1/2 top-[180px] h-[760px] w-screen -translate-x-1/2"
          style={{
            background: `radial-gradient(48% 42% at 50% 48%, color-mix(in srgb, ${accent ?? 'hsl(var(--secondary))'} 30%, transparent), transparent 72%)`,
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pt-6 lg:px-8">
          <Link
            to={`/v4/space/${space.id}`}
            className="console-focusable -ml-2 inline-flex h-9 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {space.name}
          </Link>

          {/* The masthead, centred over the deck. */}
          <div className="mx-auto mt-6 max-w-3xl text-center">
            <p className="text-[13px] tabular-nums text-quiet">
              Lesson {lesson.order}
              {pageCount > 0 && (
                <>
                  <span aria-hidden className="mx-2 text-faint">·</span>
                  {pageCount} pages
                </>
              )}
            </p>
            <h1 className="mt-3 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[64px]">
              {lesson.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2.5">
              <AuthorLine person={lesson.author} />
              {/* Always — see LessonRow. A promoted Lesson is Community origin
                  in a Guided Space, so gating on mode hid it where it mattered. */}
              <OriginBadge origin={lesson.origin} />
              <GroundingMarker grounding={lesson.grounding} spaceGroundingEnabled={space.groundingEnabled} />
              {done && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-[3px] text-[11.5px] font-medium text-success">
                  <Check aria-hidden className="h-3 w-3" />
                  Completed
                </span>
              )}
            </div>
          </div>

          <div className="mt-12">
            {pdfUrl ? (
              <LessonDeck file={pdfUrl} onOpen={start} onAccent={setAccent} label={`${startLabel}: ${lesson.title}`} />
            ) : (
              <div
                className={cn(
                  'mx-auto flex aspect-video max-w-2xl items-center justify-center rounded-3xl bg-gradient-to-br opacity-80',
                  gradientFor(lesson.order),
                )}
              >
                <Icon aria-hidden className="h-24 w-24 text-white/[0.5]" />
              </div>
            )}
          </div>

          {/* One primary action. Everything else is subordinate. */}
          <div className="mt-2 flex flex-col items-center gap-5">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {/*
                Start opens the reader on the deck where there is one, at the
                first idea not yet cleared once you have begun. Without a deck
                it keeps the old ways in: the written reader, the first idea,
                or practice.
              */}
              <LaunchButton label={startLabel} icon={Play} onClick={start} />
              {lesson.practiceCount > 0 && (
                <Link
                  to={`/v4/space/${space.id}/lesson/${lesson.id}/practice`}
                  className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-6 text-[14px] font-medium transition-colors hover:bg-white/[0.09]"
                >
                  <ListChecks aria-hidden className="h-4 w-4" />
                  Practice · {lesson.practiceCount}
                </Link>
              )}
              {/* A real lecture: a rehearsal written from its own slides. */}
              {live && (
                <Link
                  to={`/v4/space/${space.id}/rehearse?lectures=${lesson.id}`}
                  className="console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-6 text-[14px] font-medium transition-colors hover:bg-white/[0.09]"
                >
                  <Target aria-hidden className="h-4 w-4" />
                  Rehearse this lecture
                </Link>
              )}
            </div>

            {/* Progress as the ideas themselves: one segment each, lit when cleared. */}
            {lesson.concepts.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <div aria-hidden className="flex gap-1">
                  {lesson.concepts.map((c) => (
                    <span
                      key={c.id}
                      className={cn(
                        'h-1 w-10 rounded-full',
                        c.progress === 'cleared' ? 'bg-success' : c.progress === 'discovered' ? 'bg-white/[0.45]' : 'bg-white/[0.12]',
                      )}
                    />
                  ))}
                </div>
                <p className="text-[12.5px] tabular-nums text-quiet">
                  {cleared} of {lesson.concepts.length} ideas cleared
                  {lesson.contributionCount > 0 && ` · ${lesson.contributionCount} contributions`}
                </p>
              </div>
            )}

            {/* Deleting a Material never breaks its Lesson. */}
            {lesson.material === null && (
              <p className="inline-flex items-center gap-2 text-[13px] text-quiet">
                <FileWarning aria-hidden className="h-3.5 w-3.5" />
                The original file was removed. This Lesson still works.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
        {/* ── Ideas: each where it lives in the deck ── */}
        {ideasPending ? (
          <Row title="The ideas" lede="Grouping the deck into the ideas it teaches…">
            <div aria-hidden className="space-y-2 md:w-[42%]">
              {[0, 1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0.3 }}
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
                  className="h-[60px] rounded-2xl bg-white/[0.05]"
                />
              ))}
            </div>
          </Row>
        ) : ideas.length > 0 && pdfUrl ? (
          <Row
            title="The ideas"
            lede={
              live
                ? 'In the order the deck teaches them. Each lights up once a checkpoint or a rehearsal proves it.'
                : 'In the order the deck teaches them. Each lights up on the Space’s map as you clear it.'
            }
          >
            <IdeaExplorer
              ideas={
                live
                  ? ideas.map((it, i, all) => ({
                      ...it,
                      light: lightIdeas(lesson.id, all.map((x) => ({ first_page: x.firstPage })), history?.marks ?? [])[i],
                    }))
                  : ideas
              }
              file={pdfUrl}
              readHref={(p) => readerAt(p)}
              conceptHref={(id) => `/v4/space/${space.id}/concept/${id}`}
            />
          </Row>
        ) : (
          lesson.concepts.length > 0 && (
            <Row title="Ideas in this Lesson" count={lesson.concepts.length}>
              <ul className="flex flex-wrap gap-2">
                {lesson.concepts.map((c) => {
                  const st = CONCEPT_STATE[c.progress];
                  return (
                    <li key={c.id}>
                      {/* Each idea has its own overview — where it also appears,
                          its practice, and the community section at Concept
                          anchor level. */}
                      <Link
                        to={`/v4/space/${space.id}/concept/${c.id}`}
                        aria-label={`${c.name} — ${st.label}`}
                        className={cn(
                          'console-focusable inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] transition-colors hover:border-white/30',
                          st.cls,
                        )}
                      >
                        {c.progress === 'cleared' && <Check aria-hidden className="h-3 w-3" />}
                        {c.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Row>
          )
        )}

        {/* ── Tools: the pages Explain answers with something to try ── */}
        {tools.length > 0 && (
          <Row title="Try it, don’t just read it" lede="Some pages answer with a tool. Each opens in the reader at its page, with Explain beside it.">
            <ToolShelf tools={tools} href={(p) => readerAt(p, 'explain')} />
          </Row>
        )}

        {/* ── Community, at the Lesson anchor level ── (a real course has no community data yet) */}
        {!live && (
        <Row title="From the community" count={contributions.length || undefined}>
          {contributions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
              <Sparkles aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
              <p className="mb-1.5 text-[15px] font-semibold">Nothing here yet</p>
              <p className="mx-auto max-w-[44ch] text-[14px] leading-relaxed text-quiet">
                If something in this Lesson finally clicked for you, that explanation will
                help the next person.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {contributions.map((c, i) => (
                <ContributionCard
                  key={c.id}
                  contribution={c}
                  space={space}
                  isOwn={c.author.id === viewer.id}
                  onModerated={() => setNoteTick((n) => n + 1)}
                  featured={i === 0 && contributions.length > 1}
                  className={i === 0 && contributions.length > 1 ? 'sm:col-span-2' : undefined}
                />
              ))}
            </div>
          )}
        </Row>

        )}

        {/* ── Your notes: private, and the one thing only you can see ── */}
        <Row title="Your notes" count={myNotes.length || undefined}>
          <div className="space-y-2.5">
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

            {/* Doc 2 Create rule: "New Note — the reader, and in Library." */}
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
        </Row>
      </div>

      {spaceId && <LessonPager spaceId={spaceId} prev={prev} next={next} />}
    </div>,
    lesson.order,
  );
}
