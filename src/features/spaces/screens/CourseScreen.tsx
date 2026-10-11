import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpen, CalendarDays, RotateCcw, Search, Sparkles, Target, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Scene, SURFACES } from '../components/Scene';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { useCourse, useFind, useRehearsalHistory } from '../data/useReader';
import { latestInCourse, readTrail } from '../data/trail';
import { ideaAt, lightIdeas, type Light } from '../components/course/light';
import { planToday, type TodayStep } from '../components/course/today';
import { daysBetween, localToday, planExam } from '../components/course/examPlan';
import { ExamRunway } from '../components/course/ExamRunway';
import { examDateFor, setExamDate } from '../data/examDate';
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
 *
 * The map remembers you. Each lecture's marker is a ring of how far you have
 * read it (this browser's trail), the lecture you were last in is offered
 * back at the top, and each idea is lit only once a rehearsal has tested you
 * on it — right lights it, wrong marks it to revisit, untested stays dark.
 */

const SUGGESTIONS = ['functional dependency', 'two phase locking', 'B+ tree', 'join'];

export default function CourseScreen({ courseId }: { courseId: string }) {
  const { state, course } = useCourse(courseId);
  const [query, setQuery] = useState('');
  const found = useFind(courseId, query);
  const { history } = useRehearsalHistory(courseId);
  const reduce = useReducedMotion();
  /* Read once: the trail only changes while you are in the reader. */
  const [trail] = useState(readTrail);
  const [resume] = useState(() => latestInCourse(courseId));
  /* The exam date this student set for this course, if any (this browser only). */
  const [exam, setExam] = useState(() => examDateFor(courseId));
  const chooseExam = (date: string | null) => {
    setExamDate(courseId, date);
    setExam(date);
  };

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.course} status="progress" motionKey={courseId}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (state === 'loading') return chrome(<DetailSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="this Space" />);
  if (!course) return chrome(<NotFound what="Space" backTo="/v4/spaces" backLabel="Back to Spaces" />);

  const pages = course.lectures.reduce((n, l) => n + l.total_slides, 0);
  const lessonHref = (id: string) => `/v4/space/${course.id}/lesson/${id}`;
  const readHref = (id: string, page: number, spot?: string) =>
    `${lessonHref(id)}/faces?page=${page}${spot ? `&spot=${encodeURIComponent(spot)}` : ''}`;
  /* The words the search matched, as the page has them — what the reader lights. */
  const litWords = (snippet: string) => /«([^»]+)»/.exec(snippet)?.[1];

  const marks = history?.marks ?? [];
  const lights = new Map(course.lectures.map((l) => [l.id, l.ideas ? lightIdeas(l.id, l.ideas, marks) : []]));

  const resumeLecture = resume ? course.lectures.find((l) => l.id === resume.lectureId) : undefined;
  const resumeIdea = resume && resumeLecture?.ideas ? resumeLecture.ideas[ideaAt(resumeLecture.ideas, resume.page)] : undefined;
  /* With an exam date, today is the plan's first day; without one, the next three useful things. */
  const plan = exam
    ? planExam({ lectures: course.lectures, trail, marks, weak: history?.weak ?? [], exam, today: localToday() })
    : null;
  const today = plan && plan.days.length ? plan.days[0].steps : planToday({ lectures: course.lectures, marks, weak: history?.weak ?? [], resume });
  const stepHref = (step: TodayStep) =>
    step.kind === 'rehearse'
      ? `/v4/space/${course.id}/rehearse?lectures=${(step.lectureIds ?? [step.lectureId]).join(',')}`
      : readHref(step.lectureId, step.page);

  return chrome(
    <div className="relative pb-36">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[72px] left-1/2 h-[592px] w-screen -translate-x-1/2"
        style={{ background: 'radial-gradient(50% 60% at 50% 0%, hsl(var(--secondary) / 0.16), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-4xl px-6 pt-14 lg:px-8">
        {/* The masthead. */}
        <div className="text-center">
          <p className="text-[13px] tabular-nums text-quiet">
            Space
            <span aria-hidden className="mx-2 text-faint">·</span>
            {course.lectures.length} {course.lectures.length === 1 ? 'Lesson' : 'Lessons'}
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

        {/* Today: read on, revisit a miss, refresh what is fading. */}
        {(today.length > 0 || plan) && (
          <motion.section
            aria-label="Today"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="mx-auto mt-12 max-w-3xl"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 className="text-[17px] font-medium text-foreground">Today</h2>
              <ExamControl exam={exam} onChange={chooseExam} />
            </div>
            <ol
              className={cn(
                'grid gap-3',
                today.length > 1 && 'sm:grid-cols-[1.4fr_1fr]',
                today.length === 3 && 'sm:grid-rows-2',
                today.length > 3 && 'sm:grid-cols-2',
              )}
            >
              {today.map((step, i) => (
                <li key={`${step.kind}-${step.lectureId}-${step.page}`} className={cn(i === 0 && today.length === 3 && 'sm:row-span-2')}>
                  <TodayCard
                    step={step}
                    href={stepHref(step)}
                    poster={i === 0 && step.kind === 'read' ? course.lectures.find((l) => l.id === step.lectureId)?.poster ?? null : null}
                    progress={step.kind === 'read' && resume && step.lectureId === resume.lectureId ? resume.page / resume.pages : null}
                    idea={step.kind === 'read' && resume && step.lectureId === resume.lectureId && !plan ? resumeIdea?.name : undefined}
                    more={step.kind === 'revisit' && !plan ? Math.max(0, (history?.weak.length ?? 0) - 1) : 0}
                    reduce={Boolean(reduce)}
                  />
                </li>
              ))}
            </ol>
            {plan && plan.days.length > 0 && exam && <ExamRunway plan={plan} examDate={exam} hrefFor={stepHref} />}
          </motion.section>
        )}

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
                <li className="px-5 py-4 text-[14px] text-quiet">Nothing in this Space mentions that.</li>
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
        <div className="mt-20 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="text-[26px] font-medium tracking-[-0.02em]">The Space, lit by what you know</h2>
            {/* The map shows what is lit; a count of it would only say it again. */}
            {marks.length === 0 && (
              <p className="mt-1 text-[13.5px] text-quiet">Every idea starts dark. A rehearsal lights the ones you get right.</p>
            )}
          </div>
          <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-quiet">
            <li className="flex items-center gap-1.5"><IdeaDot light="lit" />Tested, right</li>
            <li className="flex items-center gap-1.5"><IdeaDot light="fading" />Fading</li>
            <li className="flex items-center gap-1.5"><IdeaDot light="weak" />To revisit</li>
            <li className="flex items-center gap-1.5"><IdeaDot light="dark" />Not tested yet</li>
          </ul>
        </div>
        <ol aria-label="Lessons" className="relative mt-10">
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
              <ReadRing order={l.order} read={trail[l.id] ? trail[l.id].page / trail[l.id].pages : 0} reduce={Boolean(reduce)} />
              <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
                {/* The deck itself is the way in: it opens where you stopped, or at the start. */}
                <Link
                  to={readHref(l.id, trail[l.id]?.page ?? 1)}
                  aria-label={trail[l.id] ? `Go on reading ${l.title}` : `Read ${l.title}`}
                  className="console-focusable group relative block self-start overflow-hidden rounded-xl bg-white/[0.04] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_-16px_rgba(0,0,0,0.8)]"
                >
                  {l.poster ? (
                    <img src={l.poster} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  ) : (
                    <span className="block aspect-video" />
                  )}
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/45 group-focus-visible:bg-black/45"
                  >
                    <span className="flex h-11 items-center gap-2 rounded-full bg-white/0 px-4 text-[13.5px] font-medium text-transparent transition-colors group-hover:bg-white group-hover:text-background group-focus-visible:bg-white group-focus-visible:text-background">
                      <BookOpen aria-hidden className="h-4 w-4" />
                      {trail[l.id] ? 'Go on' : 'Read'}
                    </span>
                  </span>
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
                      : l.ideas.map((idea, k) => {
                          const light = lights.get(l.id)?.[k] ?? 'dark';
                          return (
                          <Link
                            key={`${idea.first_page}-${idea.name}`}
                            to={readHref(l.id, idea.first_page)}
                            title={`Page ${idea.first_page}`}
                            aria-label={`${idea.name}, page ${idea.first_page}${light === 'lit' ? ', tested right' : light === 'fading' ? ', fading' : light === 'weak' ? ', to revisit' : ''}`}
                            className={cn(
                              'console-focusable inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors',
                              light === 'lit' && 'bg-success/[0.1] text-foreground hover:bg-success/[0.16]',
                              light === 'fading' && 'bg-success/[0.04] text-quiet hover:bg-success/[0.1] hover:text-foreground',
                              light === 'weak' && 'bg-destructive/[0.1] text-foreground hover:bg-destructive/[0.16]',
                              light === 'dark' && 'bg-white/[0.04] text-quiet hover:bg-white/[0.09] hover:text-foreground',
                            )}
                          >
                            <IdeaDot light={light} />
                            {idea.name}
                          </Link>
                          );
                        })}
                  </div>
                </div>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>,
  );
}

const STEP_LOOK: Record<TodayStep['kind'], { icon: typeof BookOpen; tint: string; label: string }> = {
  read: { icon: BookOpen, tint: 'bg-white text-background', label: 'Read on' },
  revisit: { icon: RotateCcw, tint: 'bg-destructive/[0.16] text-destructive', label: 'Revisit' },
  refresh: { icon: Sparkles, tint: 'bg-success/[0.14] text-success', label: 'Refresh' },
  rehearse: { icon: Target, tint: 'bg-white/[0.1] text-foreground', label: 'Rehearse' },
};

/** When the exam is — set once, and the plan follows from it. */
function ExamControl({ exam, onChange }: { exam: string | null; onChange: (date: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const today = localToday();
  if (editing || !exam) {
    return (
      <label className="flex h-9 items-center gap-2 rounded-full bg-white/[0.06] pl-3.5 pr-2 text-[13px] text-quiet focus-within:bg-white/[0.1]">
        <CalendarDays aria-hidden className="h-3.5 w-3.5" />
        <span>{exam ? 'Exam on' : 'When is your exam?'}</span>
        <input
          type="date"
          min={today}
          value={exam ?? ''}
          onChange={(e) => {
            if (e.target.value && e.target.value > today) {
              onChange(e.target.value);
              setEditing(false);
            }
          }}
          className="h-7 rounded-full bg-transparent px-1.5 text-[13px] text-foreground outline-none [color-scheme:dark]"
        />
      </label>
    );
  }
  const left = daysBetween(today, exam);
  const date = new Date(`${exam}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Change the exam date"
        className="console-focusable flex h-9 items-center gap-2 rounded-full bg-white/[0.06] px-3.5 text-[13px] text-foreground transition-colors hover:bg-white/[0.1]"
      >
        <CalendarDays aria-hidden className="h-3.5 w-3.5 text-quiet" />
        {left > 0 ? `Exam in ${left} ${left === 1 ? 'day' : 'days'}` : left === 0 ? 'Exam today' : 'Exam passed'}
        <span className="text-quiet">· {date}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="Clear the exam date"
        className="console-focusable flex h-9 w-9 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** One step of today's session: what, why, how long — and the page that does it. */
function TodayCard({
  step,
  href,
  poster,
  progress,
  idea,
  more = 0,
  reduce,
}: {
  step: TodayStep;
  /** Other ideas also marked to revisit, beyond this one. */
  more?: number;
  href: string;
  poster: string | null;
  progress: number | null;
  idea?: string;
  reduce: boolean;
}) {
  const look = STEP_LOOK[step.kind];
  return (
    <Link
      to={href}
      className="console-focusable group flex h-full flex-col overflow-hidden rounded-3xl border border-white/[0.09] bg-[#0b0b0c] transition-colors hover:border-white/[0.18]"
    >
      {poster && (
        <span className="relative block overflow-hidden bg-white/[0.04]">
          <img src={poster} alt="" className="aspect-[2/1] w-full object-cover" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#0b0b0c] to-transparent" />
        </span>
      )}
      <span className="flex flex-1 flex-col p-4">
        <span className="flex items-center justify-between gap-3">
          <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium', look.tint)}>
            <look.icon aria-hidden className="h-3 w-3" />
            {look.label}
          </span>
          <span className="text-[12.5px] tabular-nums text-faint">~{step.minutes} min</span>
        </span>
        <span className="mt-3 block text-[15.5px] font-medium leading-snug text-foreground">{step.title}</span>
        <span className="mt-1 block text-[13px] leading-[1.45] text-quiet">
          {step.why}
          {idea && <> · {idea}</>}
        </span>
        {more > 0 && (
          <span className="mt-1.5 block text-[12.5px] text-faint">
            and {more} more marked to revisit — they show red on the map below
          </span>
        )}
        {progress !== null && (
          <span aria-hidden className="mt-3.5 block h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
            <motion.span
              className="block h-full origin-left rounded-full bg-white"
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: progress }}
              transition={{ duration: 0.8, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
            />
          </span>
        )}
        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-quiet transition-colors group-hover:text-foreground">
          Open
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </span>
      </span>
    </Link>
  );
}

/** An idea's light: a lit dot glows, a fading one has lost its glow, a dark one is only an outline. */
function IdeaDot({ light }: { light: Light }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        light === 'lit' && 'bg-success shadow-[0_0_8px_hsl(var(--success))]',
        light === 'fading' && 'bg-success/[0.4]',
        light === 'weak' && 'bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]',
        light === 'dark' && 'border border-white/[0.3]',
      )}
    />
  );
}

/** A lecture's marker on the line, ringed by how far you have read it. */
function ReadRing({ order, read, reduce }: { order: number; read: number; reduce: boolean }) {
  const R = 18;
  return (
    <span className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-full bg-black text-[13px] tabular-nums text-foreground">
      <svg aria-hidden viewBox="0 0 40 40" className="absolute inset-0 h-10 w-10 -rotate-90">
        <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
        {read > 0 && (
          <motion.circle
            cx="20"
            cy="20"
            r={R}
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            whileInView={{ pathLength: read }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </svg>
      {order}
      {read > 0 && <span className="sr-only">, {Math.round(read * 100)}% read</span>}
    </span>
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
