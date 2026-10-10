import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpen, Search, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Scene, SURFACES } from '../components/Scene';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { useCourse, useFind } from '../data/useReader';
import { viewer } from '../mocks/people';

/**
 * A real course, as one journey.
 *
 * Every lecture in order down a single line — its title page, its pages, the
 * ideas it teaches — so the whole course can be seen at once and entered
 * anywhere: a lecture's overview, its first page, or straight at one idea.
 * Above it, the question a student actually has before an exam: *where was
 * that taught?* — answered across every slide of every lecture as you type,
 * each hit opening the reader at that page with the words lit.
 *
 * Read live (`useCourse`); the ideas of lectures nobody has opened yet are
 * grouped one by one as the page sits there, so the map draws itself once
 * and is instant after.
 */

const SUGGESTIONS = ['functional dependency', 'two phase locking', 'B+ tree', 'join'];

export default function CourseScreen({ courseId }: { courseId: string }) {
  const { state, course } = useCourse(courseId);
  const [query, setQuery] = useState('');
  const found = useFind(courseId, query);
  const reduce = useReducedMotion();

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.spaceOverview} status="progress" motionKey={courseId}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (state === 'loading') return chrome(<DetailSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="this course" />);
  if (!course) return chrome(<NotFound what="Course" backTo="/v4/spaces" backLabel="Back to Spaces" />);

  const pages = course.lectures.reduce((n, l) => n + l.total_slides, 0);
  const lessonHref = (id: string) => `/v4/space/${course.id}/lesson/${id}`;
  const readHref = (id: string, page: number, spot?: string) =>
    `${lessonHref(id)}/faces?page=${page}${spot ? `&spot=${encodeURIComponent(spot)}` : ''}`;
  /* The words the search matched, as the page has them — what the reader lights. */
  const litWords = (snippet: string) => /«([^»]+)»/.exec(snippet)?.[1];

  return chrome(
    <div className="relative pb-36">
      <div aria-hidden className="absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-black" />
      <div
        aria-hidden
        className="absolute left-1/2 top-0 h-[520px] w-screen -translate-x-1/2"
        style={{ background: 'radial-gradient(50% 60% at 50% 0%, hsl(var(--secondary) / 0.16), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-4xl px-6 pt-14 lg:px-8">
        {/* The masthead. */}
        <div className="text-center">
          <p className="text-[13px] tabular-nums text-quiet">
            Course
            <span aria-hidden className="mx-2 text-faint">·</span>
            {course.lectures.length} lectures
            <span aria-hidden className="mx-2 text-faint">·</span>
            {pages} pages
          </p>
          <h1 className="mt-3 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[64px]">{course.title}</h1>
          {course.author && <p className="mt-4 text-[14px] text-quiet">{course.author}</p>}
          <Link
            to={`/v4/space/${course.id}/rehearse`}
            className="console-focusable mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-background"
          >
            <Target aria-hidden className="h-4 w-4" />
            Rehearse for the exam
          </Link>
        </div>

        {/* Where was that taught? */}
        <div className="relative mx-auto mt-12 max-w-2xl">
          <label className="flex h-14 items-center gap-3 rounded-full border border-white/[0.1] bg-white/[0.04] px-5 focus-within:border-white/[0.24]">
            <Search aria-hidden className="h-[18px] w-[18px] shrink-0 text-quiet" />
            <span className="sr-only">Find where a topic is taught</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Where was … taught?"
              maxLength={120}
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-faint"
            />
            {found.busy && <span className="text-[12px] text-faint">Looking…</span>}
          </label>
          {query.trim().length < 2 ? (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuery(s)}
                  className="console-focusable h-8 rounded-full bg-white/[0.05] px-3.5 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.09] hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <motion.ol
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              aria-label="Where it is taught"
              className="mt-3 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0b0b0c]"
            >
              {found.results.length === 0 && !found.busy && (
                <li className="px-5 py-4 text-[14px] text-quiet">Nothing in this course mentions that.</li>
              )}
              {found.results.map((r) => (
                <li key={`${r.lecture_id}-${r.page}`} className="border-b border-white/[0.05] last:border-0">
                  <Link
                    to={readHref(r.lecture_id, r.page, litWords(r.snippet))}
                    className="console-focusable group flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="mt-0.5 w-24 shrink-0 text-[12.5px] leading-[1.4] text-quiet">
                      {r.lecture_title}
                      <span className="block tabular-nums text-faint">page {r.page}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-foreground">{r.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[1.5] text-quiet">
                        <Marked text={r.snippet} />
                      </span>
                    </span>
                    <ArrowRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </motion.ol>
          )}
        </div>

        {/* The journey. */}
        <ol aria-label="Lectures" className="relative mt-20">
          <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-px bg-gradient-to-b from-white/[0.18] via-white/[0.08] to-transparent" />
          {course.lectures.map((l, i) => (
            <motion.li
              key={l.id}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: reduce ? 0 : 0.3 }}
              className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-5 pb-12"
            >
              <span className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-black text-[13px] tabular-nums text-foreground">
                {l.order}
              </span>
              <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
                <Link
                  to={lessonHref(l.id)}
                  aria-label={`${l.title} — overview`}
                  className="console-focusable block self-start overflow-hidden rounded-xl bg-white/[0.04] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_-16px_rgba(0,0,0,0.8)]"
                >
                  {l.poster ? (
                    <img src={l.poster} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  ) : (
                    <span className="block aspect-video" />
                  )}
                </Link>
                <div className="min-w-0">
                  <h2 className="text-[22px] font-medium leading-tight tracking-[-0.015em]">
                    <Link to={lessonHref(l.id)} className="console-focusable rounded-sm hover:underline hover:decoration-white/30 hover:underline-offset-4">
                      {l.title}
                    </Link>
                  </h2>
                  <p className="mt-1 text-[13px] tabular-nums text-quiet">{l.total_slides} pages</p>
                  <div className="mt-3.5 flex flex-wrap gap-1.5">
                    {l.ideas === null
                      ? [64, 92, 76].map((w) => (
                          <motion.span
                            key={w}
                            aria-hidden
                            initial={{ opacity: 0.35 }}
                            animate={{ opacity: [0.35, 0.7, 0.35] }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                            className="h-7 rounded-full bg-white/[0.08]"
                            style={{ width: w }}
                          />
                        ))
                      : l.ideas.map((idea) => (
                          <Link
                            key={`${idea.first_page}-${idea.name}`}
                            to={readHref(l.id, idea.first_page)}
                            className="console-focusable inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.05] px-3 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.1] hover:text-foreground"
                          >
                            {idea.name}
                            <span className="tabular-nums text-faint">p{idea.first_page}</span>
                          </Link>
                        ))}
                  </div>
                  <Link
                    to={readHref(l.id, 1)}
                    className={cn(
                      'console-focusable mt-4 inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                      'bg-white text-background',
                    )}
                  >
                    <BookOpen aria-hidden className="h-3.5 w-3.5" />
                    Read
                  </Link>
                </div>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>,
  );
}

/** A search snippet with its «matched» words lit. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(«[^»]+»)/g).map((p, i) =>
        p.startsWith('«') ? (
          <mark key={i} className="rounded-sm bg-transparent font-medium text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
