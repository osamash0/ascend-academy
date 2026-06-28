import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, BookOpen, Sparkles, ChevronUp, ChevronDown, ChevronLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import { useLectureTagline } from '@/features/student/hooks/useLectureTagline';
import { splitLectureTitle, cn } from '@/lib/utils';
import { topicIcon } from '@/lib/topicIcon';
import type { Lecture, StudentProgress, CourseSummary } from '@/types/domain';
import { CourseDetailsSheet } from '@/features/student/components/CourseDetailsSheet';
import { CourseCatalogSheet } from '@/features/student/components/CourseCatalogSheet';
import { getCourseSchedule } from '@/features/student/courseSchedules';
import { InlineLecturePlayer } from '@/features/student/components/InlineLecturePlayer';
import {
  DepthScene,
  ConsoleTile,
  StatusPill,
  LaunchButton,
  LectureBackdrop,
  gradientFor,
  type ConsoleStatus,
} from '@/components/console';

/**
 * StudentCourseLibrary — a PlayStation-5-style home screen.
 *
 * Two stacked, independently-navigable rows like the PS5 dashboard:
 *   • Top rail  — courses as compact "app" tiles (the boxes).
 *   • Hero      — key art + meta for whatever is focused.
 *   • Bottom rail — the focused course's lectures (its content).
 *
 * Navigation mirrors a controller: ←/→ moves within the active row, ↓ drops
 * focus into the lecture row, ↑ returns to the courses, and Enter opens the
 * focused box. Mouse/touch work too (click to focus, click again to open).
 */

interface DerivedLecture {
  lecture: Lecture;
  badge: string | null;
  cleanTitle: string;
  completed: number;
  progress: number;
  status: ConsoleStatus;
}

interface DerivedCourse {
  id: string;
  title: string;
  description: string | null;
  whatYouWillLearn: string[];
  averageRating?: number;
  ratingCount: number;
  lecturesCount: number;
  completedLectures: number;
  progress: number;
  status: ConsoleStatus;
}

type Row = 'courses' | 'lectures';

// Staggered "shelf" reveal for the lecture row once the screen transition lands.
const shelfContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const shelfCard = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } },
};

import { useCurriculumTranslation } from '@/hooks/useCurriculumTranslation';

export default function StudentCourseLibrary() {
  const { courseId } = useParams<{ courseId?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['dashboard', 'common']);
  const translateCurriculum = useCurriculumTranslation();
  const { data, isLoading, isError, refetch } = useStudentDashboard();

  // Must be declared before the useMemo that uses it.
  const [lastOpenedCourseId, setLastOpenedCourseId] = useState<string | null>(() =>
    localStorage.getItem('ascend_last_opened_course')
  );

  const lectures = useMemo(() => data?.lectures ?? [], [data]);
  const progressList = useMemo<StudentProgress[]>(() => data?.progress ?? [], [data]);

  // Group every lecture into its course, building both the course list (top
  // rail) and a per-course list of derived lectures (bottom rail).
  const { courseList, lecturesByCourse } = useMemo(() => {
    const lecMap = new Map<string, DerivedLecture[]>();
    const courseMeta = new Map<string, DerivedCourse>();
    const getProgress = (id: string) => progressList.find((p) => p.lecture_id === id);

    // Pre-seed courseMeta with explicitly enrolled courses to handle empty courses
    data?.courses?.forEach(c => {
      if (!c.id) return;
      const cTitle = translateCurriculum(c.title || 'Unknown Course');
      courseMeta.set(c.id, {
        id: c.id,
        title: cTitle,
        description: c.description ?? null,
        whatYouWillLearn: (c as any).what_you_will_learn ?? [],
        averageRating: (c as any).average_rating ?? undefined,
        ratingCount: (c as any).rating_count ?? 0,
        lecturesCount: 0,
        completedLectures: 0,
        progress: 0,
        status: 'new',
      });
      lecMap.set(c.id, []);
    });

    lectures.forEach((l) => {
      const cid = l.course_id || l.course?.id || '__uncat__';
      if (!courseMeta.has(cid)) {
        const fallbackTitle = cid === '__uncat__'
              ? t('dashboard:uncategorized', 'Uncategorized')
              : translateCurriculum(l.course?.title || 'Unknown Course');
        courseMeta.set(cid, {
          id: cid,
          title: fallbackTitle,
          description: l.course?.description ?? null,
          whatYouWillLearn: (l.course as any)?.what_you_will_learn ?? [],
          averageRating: (l.course as any)?.average_rating ?? undefined,
          ratingCount: (l.course as any)?.rating_count ?? 0,
          lecturesCount: 0,
          completedLectures: 0,
          progress: 0,
          status: 'new',
        });
        lecMap.set(cid, []);
      }

      const { badge, cleanTitle } = splitLectureTitle(translateCurriculum(l.title));
      const completed = getProgress(l.id)?.completed_slides?.length ?? 0;
      const total = l.total_slides;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const status: ConsoleStatus = pct === 100 ? 'done' : completed > 0 ? 'progress' : 'new';
      lecMap.get(cid)!.push({ lecture: l, badge, cleanTitle, completed, progress: pct, status });

      const cm = courseMeta.get(cid)!;
      cm.lecturesCount++;
      if (total > 0 && completed >= total) cm.completedLectures++;
    });

    // Order lectures within a course by their numeric badge, then by recency.
    lecMap.forEach((arr) =>
      arr.sort((a, b) => {
        const va = a.badge ? parseFloat(a.badge) : Infinity;
        const vb = b.badge ? parseFloat(b.badge) : Infinity;
        if (va !== vb) return va - vb;
        return new Date(a.lecture.created_at).getTime() - new Date(b.lecture.created_at).getTime();
      }),
    );

    const list = Array.from(courseMeta.values())
      .filter((c) => c.id !== '__uncat__')
      .map((c) => {
        c.progress = c.lecturesCount > 0 ? Math.round((c.completedLectures / c.lecturesCount) * 100) : 0;
        c.status = c.progress === 100 ? 'done' : c.progress > 0 ? 'progress' : 'new';
        return c;
      })
      .sort((a, b) => {
        if (a.id === b.id) return 0;
        // Courses with lectures before empty ones
        const aHas = a.lecturesCount > 0 ? 0 : 1;
        const bHas = b.lecturesCount > 0 ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        // Last opened next
        if (a.id === lastOpenedCourseId) return -1;
        if (b.id === lastOpenedCourseId) return 1;
        // Fallback: progress desc
        return b.progress - a.progress;
      });

    return { courseList: list, lecturesByCourse: lecMap };
  }, [lectures, progressList, t, lastOpenedCourseId]);

  const [courseFocus, setCourseFocus] = useState(0);
  const [lectureFocus, setLectureFocus] = useState(0);
  const [activeRow, setActiveRow] = useState<Row>('courses');
  // Hold the heavy lecture shelf back until the route transition settles, then
  // cascade it in — keeps the slide-from-home entrance smooth.
  const [shelfReady, setShelfReady] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  // Collapse the course rail to only what matters now (started + recent);
  // the rest live behind a "Show all" tile so the screen isn't a wall of icons.
  const [showAllCourses, setShowAllCourses] = useState(false);
  // The lecture opened inline (below the rails). null = no inline player.
  const [inlineLectureId, setInlineLectureId] = useState<string | null>(null);
  // Active slide index inside the inline player — drives the wallpaper.
  const [inlineSlideIndex, setInlineSlideIndex] = useState(0);
  const inlineRef = useRef<HTMLDivElement>(null);

  // Set of already enrolled course IDs so the catalog can mark them.
  const enrolledCourseIds = useMemo(() => new Set(courseList.map(c => c.id)), [courseList]);

  // Parse the semester from a course's description/title — same rule the skill
  // tree uses (e.g. "… 4. Semester" → 4). null when none is stated.
  const semesterOf = useCallback((c: DerivedCourse) => {
    const text = `${c.description || ''} ${c.title}`;
    const m = text.match(/(\d+)\.\s*Semester/i) || text.match(/Semester\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }, []);

  // The semester that leads the rail = the semester of the highest-priority
  // course in the sorted courseList (has-lectures, then last-opened, then
  // progress). This keeps the lead semester in sync with the sort order.
  const leadSemester = useMemo(() => {
    const first = courseList.find((c) => semesterOf(c) != null);
    return first ? semesterOf(first) : null;
  }, [courseList, semesterOf]);

  // Courses grouped by semester: the lead (current) semester first, the rest
  // ascending, and any without a stated semester last. courseList is already
  // sorted last-opened → highest-progress, so order holds inside each group.
  const semesterGroups = useMemo(() => {
    const byKey = new Map<number | 'none', DerivedCourse[]>();
    courseList.forEach((c) => {
      const s = semesterOf(c);
      const key: number | 'none' = s == null ? 'none' : s;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(c);
    });
    const sems = [...byKey.keys()]
      .filter((k): k is number => k !== 'none')
      .sort((a, b) => {
        if (a === leadSemester) return -1;
        if (b === leadSemester) return 1;
        return a - b;
      });
    const groups = sems.map((s) => ({
      key: String(s),
      label: t('dashboard:semesterN', '{{n}}. Semester', { n: s }),
      courses: byKey.get(s)!,
    }));
    if (byKey.has('none')) {
      groups.push({ key: 'none', label: t('dashboard:otherCourses', 'Other'), courses: byKey.get('none')! });
    }
    return groups;
  }, [courseList, semesterOf, leadSemester, t]);

  // Collapsed, the rail shows only the lead semester; "Show all" reveals the
  // rest. railCourses is the flat list the focus index and keyboard nav use.
  const railGroups = showAllCourses ? semesterGroups : semesterGroups.slice(0, 1);
  const railCourses = railGroups.flatMap((g) => g.courses);
  const hiddenCount = courseList.length - railCourses.length;

  // Toggle the rail while keeping the focused course focused across the resize.
  const toggleShowAll = useCallback(() => {
    const focusedId = railCourses[courseFocus]?.id;
    const next = !showAllCourses;
    const nextCourses = (next ? semesterGroups : semesterGroups.slice(0, 1)).flatMap((g) => g.courses);
    setShowAllCourses(next);
    const idx = focusedId ? nextCourses.findIndex((c) => c.id === focusedId) : 0;
    setCourseFocus(idx >= 0 ? idx : 0);
  }, [railCourses, courseFocus, showAllCourses, semesterGroups]);

  // Preselect the course from the URL (deep link from /course-v3/:courseId).
  useEffect(() => {
    if (!courseList.length) return;
    if (courseId) {
      const leadCourses = semesterGroups[0]?.courses ?? [];
      const visibleIdx = leadCourses.findIndex((c) => c.id === courseId);
      if (visibleIdx >= 0) {
        setCourseFocus(visibleIdx);
      } else {
        // The linked course is in another semester — reveal all and focus it.
        setShowAllCourses(true);
        const all = semesterGroups.flatMap((g) => g.courses);
        setCourseFocus(Math.max(0, all.findIndex((c) => c.id === courseId)));
      }
    } else {
      setCourseFocus(0);
    }
    setActiveRow('courses');
    setLectureFocus(0);
  }, [courseId, courseList.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusedCourse = railCourses[courseFocus];
  const courseLectures = useMemo(
    () => (focusedCourse ? lecturesByCourse.get(focusedCourse.id) ?? [] : []),
    [focusedCourse, lecturesByCourse],
  );

  // The lecture to resume into for the focused course: first one in progress,
  // else the first unstarted, else just the first. Drives the "Continue" action.
  const resumeLecture = useMemo(
    () =>
      courseLectures.find((l) => l.status === 'progress') ??
      courseLectures.find((l) => l.status === 'new') ??
      courseLectures[0],
    [courseLectures],
  );

  // Keep the lecture cursor in range as the focused course changes.
  useEffect(() => {
    setLectureFocus((f) => Math.min(f, Math.max(0, courseLectures.length - 1)));
  }, [courseLectures.length]);

  const focusedLecture = activeRow === 'lectures' ? courseLectures[lectureFocus] : undefined;
  const { data: aiTagline, isLoading: taglineLoading } = useLectureTagline(focusedLecture?.lecture.id);

  const open = useCallback((id: string, cid?: string) => {
    if (cid) {
      localStorage.setItem('ascend_last_opened_course', cid);
      setLastOpenedCourseId(cid);
    }
    navigate(`/lecture/${id}`);
  }, [navigate]);

  // Open a lecture inline, below the rails, and scroll down to reveal it.
  const openInline = useCallback((id: string, cid?: string) => {
    if (cid) {
      localStorage.setItem('ascend_last_opened_course', cid);
      setLastOpenedCourseId(cid);
    }
    setInlineSlideIndex(0);
    setInlineLectureId(id);
  }, []);

  // Smooth-scroll all the way down to the inline player once it opens. Run a
  // second pass after the player has loaded (its PDF makes the panel grow), so
  // we land at the true bottom.
  useEffect(() => {
    if (!inlineLectureId) return;
    const toBottom = () => inlineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    const t1 = setTimeout(toBottom, 100);
    const t2 = setTimeout(toBottom, 550);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [inlineLectureId]);

  // Reveal the lecture shelf just after the screen transition completes.
  useEffect(() => {
    const id = setTimeout(() => setShelfReady(true), 260);
    return () => clearTimeout(id);
  }, []);

  const dropIntoLectures = useCallback(() => {
    if (courseLectures.length) {
      setActiveRow('lectures');
      setLectureFocus(0);
      if (focusedCourse) {
        localStorage.setItem('ascend_last_opened_course', focusedCourse.id);
        setLastOpenedCourseId(focusedCourse.id);
      }
    }
  }, [courseLectures.length, focusedCourse]);

  // Controller-style keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the inline lecture player is open it owns keyboard focus —
      // don't let the rails react to arrow/Enter behind it.
      if (inlineLectureId) return;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (activeRow === 'courses') setCourseFocus((i) => Math.min(i + 1, railCourses.length - 1));
          else setLectureFocus((i) => Math.min(i + 1, courseLectures.length - 1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (activeRow === 'courses') setCourseFocus((i) => Math.max(i - 1, 0));
          else setLectureFocus((i) => Math.max(i - 1, 0));
          break;
        case 'ArrowDown':
          if (activeRow === 'courses' && courseLectures.length) {
            e.preventDefault();
            dropIntoLectures();
          }
          break;
        case 'ArrowUp':
          if (activeRow === 'lectures') {
            e.preventDefault();
            setActiveRow('courses');
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (activeRow === 'courses') dropIntoLectures();
          else if (focusedLecture) openInline(focusedLecture.lecture.id, focusedCourse?.id);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeRow, railCourses.length, courseLectures.length, focusedLecture, dropIntoLectures, openInline, inlineLectureId, focusedCourse?.id]);

  // Keep the focused tile scrolled into view in each rail.
  const courseRailRef = useRef<HTMLDivElement>(null);
  const lectureRailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    courseRailRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [courseFocus]);
  useEffect(() => {
    if (activeRow !== 'lectures') return;
    lectureRailRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [lectureFocus, activeRow, focusedCourse?.id]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Distinguish a genuine load failure from a legitimately empty library —
  // otherwise a failed fetch silently renders the same "Empty Library" screen.
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <AlertTriangle className="w-14 h-14 text-destructive/60 mb-4" />
        <h3 className="text-2xl font-black">{t('common:loadError', "Couldn't load your courses")}</h3>
        <p className="text-muted-foreground mb-8">
          {t('common:loadErrorHint', 'Something went wrong reaching the server. Please try again.')}
        </p>
        <button
          onClick={() => refetch()}
          className="console-focusable flex items-center justify-center h-14 px-10 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-wide shadow-glow-primary transition-all active:scale-95"
        >
          {t('common:retry', 'Try Again')}
        </button>
      </div>
    );
  }

  if (!courseList.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <BookOpen className="w-14 h-14 text-muted-foreground/40 mb-4" />
        <h3 className="text-2xl font-black">{t('dashboard:emptyLibrary', 'Empty Library')}</h3>
        <p className="text-muted-foreground mb-8">
          You aren't enrolled in any courses yet.
        </p>
        <button
          onClick={() => setIsCatalogOpen(true)}
          className="console-focusable flex items-center justify-center h-14 px-10 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-wide shadow-glow-primary transition-all active:scale-95"
        >
          Browse Course Catalog
        </button>

        <CourseCatalogSheet
          isOpen={isCatalogOpen}
          onClose={() => setIsCatalogOpen(false)}
          enrolledCourseIds={enrolledCourseIds}
        />
      </div>
    );
  }

  const heroIsLecture = activeRow === 'lectures' && !!focusedLecture;
  const heroStatus: ConsoleStatus = heroIsLecture
    ? focusedLecture!.status
    : focusedCourse?.status ?? 'progress';
  const railScroll = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

  return (
    <DepthScene
      status={heroStatus}
      gradientIndex={inlineLectureId ? inlineSlideIndex : heroIsLecture ? lectureFocus : courseFocus}
      motionKey={
        inlineLectureId
          ? `inline-${inlineLectureId}-${inlineSlideIndex}`
          : heroIsLecture
            ? focusedLecture!.lecture.id
            : focusedCourse?.id
      }
      backdrop={
        <LectureBackdrop
          lectureId={heroIsLecture ? focusedLecture!.lecture.id : undefined}
          pdfUrl={heroIsLecture ? focusedLecture!.lecture.pdf_url : undefined}
        />
      }
    >
      {/* ── Persistent Top Navigation ── */}
      <div className="absolute top-6 right-6 lg:right-12 z-50">
        <button
          onClick={() => setIsCatalogOpen(true)}
          className="console-focusable flex items-center gap-2 h-10 px-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold uppercase tracking-wider transition-all"
        >
          Discover
        </button>
      </div>

      <section className="relative flex min-h-[calc(100svh-4rem)] flex-col text-foreground select-none">
        {/* ── Top rail: courses (the "apps") ── */}
        <div className="pt-5">
          <motion.div
            ref={courseRailRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={cn('flex items-start gap-5 overflow-x-auto px-6 lg:px-12 pb-2', railScroll)}
          >
            {(() => {
              let flat = -1;
              return railGroups.map((g) => (
                <div key={`sem-${g.key}`} className="flex items-start gap-5">
                  {/* Semester label leading its group of course tiles. */}
                  <div className="flex h-24 shrink-0 items-center pr-1">
                    <span className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
                      {g.label}
                    </span>
                  </div>
                  {g.courses.map((c) => {
                    const i = ++flat;
                    const active = i === courseFocus;
                    const dim = activeRow === 'lectures';
                    return (
                <button
                  key={c.id}
                  data-active={active}
                  onClick={() => {
                    setCourseFocus(i);
                    setActiveRow('courses');
                  }}
                  onDoubleClick={() => {
                    setCourseFocus(i);
                    const lx = lecturesByCourse.get(c.id) ?? [];
                    if (lx.length) {
                      setActiveRow('lectures');
                      setLectureFocus(0);
                      localStorage.setItem('ascend_last_opened_course', c.id);
                      setLastOpenedCourseId(c.id);
                    }
                  }}
                  className="console-focusable group flex shrink-0 flex-col items-center gap-2 outline-none"
                  aria-label={c.title}
                >
                  <motion.div
                    animate={{ scale: active ? 1 : 0.9, opacity: active ? 1 : dim ? 0.4 : 0.7 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                    className={cn(
                      'relative h-24 w-24 overflow-hidden rounded-3xl border bg-gradient-to-br',
                      gradientFor(i),
                      active
                        ? 'border-white/40 ring-1 ring-white/25 shadow-[0_0_30px_-12px_rgba(255,255,255,0.45)]'
                        : 'border-white/10',
                    )}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      {(() => {
                        const CourseIcon = topicIcon(c.title, c.id);
                        return <CourseIcon className="h-10 w-10 text-white/70" />;
                      })()}
                    </div>
                    {c.status === 'done' && (
                      <div className="absolute top-2 right-2 bg-emerald-500/90 text-white p-0.5 rounded-full shadow-sm">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {c.progress > 0 && c.progress < 100 && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-secondary"
                          style={{ width: `${c.progress}%` }}
                        />
                      </div>
                    )}
                  </motion.div>
                  <span
                    className={cn(
                      'max-w-[7rem] truncate text-center text-[11px] font-bold transition-colors',
                      active ? 'text-white/85' : 'text-transparent',
                    )}
                  >
                    {c.title}
                  </span>
                </button>
                    );
                  })}
                </div>
              ));
            })()}

            {/* Reveal / collapse the rest of the catalog without leaving the screen. */}
            {(hiddenCount > 0 || showAllCourses) && (
              <button
                onClick={toggleShowAll}
                className="console-focusable group flex shrink-0 flex-col items-center gap-2 outline-none"
                aria-label={
                  showAllCourses
                    ? t('dashboard:showLess', 'Show fewer courses')
                    : t('dashboard:showAllCourses', 'Show all courses')
                }
              >
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.03] text-white/50 transition-colors group-hover:border-white/40 group-hover:text-white/85">
                  {showAllCourses ? (
                    <ChevronLeft className="h-8 w-8" />
                  ) : (
                    <span className="text-lg font-black">+{hiddenCount}</span>
                  )}
                </div>
                <span className="max-w-[7rem] truncate text-center text-[11px] font-bold text-white/40">
                  {showAllCourses
                    ? t('dashboard:showLess', 'Show less')
                    : t('dashboard:showAll', 'Show all')}
                </span>
              </button>
            )}
          </motion.div>
        </div>

        {/* ── Hero: focused box ── */}
        <div className="flex flex-1 items-end px-6 lg:px-12 pb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={heroIsLecture ? focusedLecture!.lecture.id : focusedCourse?.id ?? 'none'}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="max-w-2xl space-y-4"
            >
              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-primary/80">
                {heroIsLecture ? t('dashboard:lecture', 'Lecture') : t('dashboard:course', 'Course')}
              </span>
              <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
                {heroIsLecture ? focusedLecture!.cleanTitle : focusedCourse?.title}
              </h1>

              <div className="flex items-center gap-3">
                <StatusPill status={heroStatus} />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {heroIsLecture
                    ? `${focusedLecture!.completed}/${focusedLecture!.lecture.total_slides} units · ${focusedLecture!.progress}%`
                    : `${focusedCourse?.completedLectures}/${focusedCourse?.lecturesCount} lectures · ${focusedCourse?.progress}%`}
                </span>
              </div>

              <p className="text-muted-foreground line-clamp-2 min-h-[2.5rem] flex items-center gap-2">
                {heroIsLecture ? (
                  aiTagline ? (
                    <span className="italic">“{aiTagline}”</span>
                  ) : taglineLoading ? (
                    <span className="flex items-center gap-2 opacity-70">
                      <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
                      Composing a tagline…
                    </span>
                  ) : (
                    focusedLecture!.lecture.description ||
                    (focusedLecture!.status === 'done'
                      ? 'Mastered. Jump back in for a quick review.'
                      : focusedLecture!.status === 'progress'
                      ? 'Pick up right where you left off.'
                      : 'A fresh challenge awaits. Here comes the feeling…')
                  )
                ) : focusedCourse?.description ? (
                  focusedCourse.description
                ) : focusedCourse?.status === 'done' ? (
                  'All lectures completed.'
                ) : (
                  `${courseLectures.length} lecture${courseLectures.length === 1 ? '' : 's'}`
                )}
              </p>

              <div className="flex items-center gap-4 pt-1">
                {heroIsLecture ? (
                  <LaunchButton
                    label={
                      focusedLecture!.status === 'new'
                        ? 'Start Lecture'
                        : focusedLecture!.status === 'done'
                        ? 'Review'
                        : 'Continue'
                    }
                    icon={Play}
                    onClick={() => openInline(focusedLecture!.lecture.id, focusedCourse?.id)}
                  />
                ) : (
                  <>
                    {focusedCourse && focusedCourse.progress > 0 && resumeLecture ? (
                      <LaunchButton
                        label="Continue"
                        icon={Play}
                        onClick={() => openInline(resumeLecture.lecture.id, focusedCourse.id)}
                      />
                    ) : (
                      <LaunchButton
                        label="Browse Lectures"
                        icon={ChevronDown}
                        onClick={dropIntoLectures}
                      />
                    )}
                    <button
                      onClick={() => setIsDetailsOpen(true)}
                      className="console-focusable flex items-center gap-2 h-12 px-6 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-sm font-bold transition-all"
                    >
                      <BookOpen className="w-4 h-4" />
                      View Details
                    </button>
                  </>
                )}
                {heroIsLecture && (
                  <button
                    onClick={() => setActiveRow('courses')}
                    className="console-focusable flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronUp className="w-4 h-4" /> {t('dashboard:course', 'Courses')}
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── Bottom rail: lectures of the focused course ── */}
        <div className="pb-8">
          <div className="px-6 lg:px-12 pb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.25em] text-white/40">
            {focusedCourse?.title} · {courseLectures.length}{' '}
            {courseLectures.length === 1 ? 'lecture' : 'lectures'}
          </div>
          {!shelfReady ? (
            <div className={cn('flex items-stretch gap-4 overflow-x-auto px-6 lg:px-12 pb-3', railScroll)}>
              {Array.from({ length: Math.min(Math.max(courseLectures.length, 1), 5) }).map((_, i) => (
                <div key={i} className="h-40 w-64 shrink-0 rounded-2xl bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : courseLectures.length === 0 ? (
            <div
              ref={lectureRailRef}
              className={cn('flex items-stretch gap-4 overflow-x-auto px-6 lg:px-12 pb-3', railScroll)}
            >
              <div className="py-10 text-sm text-muted-foreground">No lectures in this course yet.</div>
            </div>
          ) : (
            <motion.div
              ref={lectureRailRef}
              variants={shelfContainer}
              initial="hidden"
              animate="show"
              className={cn('flex items-stretch gap-4 overflow-x-auto px-6 lg:px-12 pb-3', railScroll)}
            >
              {courseLectures.map((d, i) => {
                const active = activeRow === 'lectures' && i === lectureFocus;
                return (
                  <motion.button
                    key={d.lecture.id}
                    variants={shelfCard}
                    data-active={active}
                    onClick={() => {
                      if (activeRow === 'lectures' && i === lectureFocus) {
                        openInline(d.lecture.id, focusedCourse?.id);
                      } else {
                        setActiveRow('lectures');
                        setLectureFocus(i);
                      }
                    }}
                    className="console-focusable shrink-0 outline-none"
                    aria-label={`${d.cleanTitle}. ${d.progress}% complete.`}
                  >
                    <motion.div
                      animate={{
                        scale: active ? 1 : 0.95,
                        opacity: activeRow === 'courses' ? 0.75 : active ? 1 : 0.5,
                      }}
                      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                      className="h-40 w-64"
                    >
                      <ConsoleTile
                        isActive={active}
                        gradientIndex={i}
                        title={d.cleanTitle}
                        eyebrow={d.badge ? `Lecture ${d.badge}` : 'Lecture'}
                        progress={d.progress}
                        watermark={(() => {
                          const LectureIcon = topicIcon(d.cleanTitle, d.lecture.id);
                          return <LectureIcon className="w-10 h-10 text-white/15" />;
                        })()}
                        badge={d.status === 'done' ? { kind: 'done', label: 'Done' } : undefined}
                      />
                    </motion.div>
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </div>

        {/* ── Inline lecture player: revealed below the rails on lecture open ── */}
        <AnimatePresence>
          {inlineLectureId && (
            <motion.div
              ref={inlineRef}
              key={inlineLectureId}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="px-6 lg:px-12 pb-16 pt-2 scroll-mt-6"
            >
              <InlineLecturePlayer
                lectureId={inlineLectureId}
                courseTitle={focusedCourse?.title}
                onClose={() => setInlineLectureId(null)}
                onExpand={() => open(inlineLectureId, focusedCourse?.id)}
                onSlideChange={setInlineSlideIndex}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {focusedCourse && (
        <CourseDetailsSheet
          isOpen={isDetailsOpen}
          onClose={() => setIsDetailsOpen(false)}
          courseId={focusedCourse.id}
          title={focusedCourse.title}
          description={focusedCourse.description}
          whatYouWillLearn={focusedCourse.whatYouWillLearn}
          averageRating={focusedCourse.averageRating}
          ratingCount={focusedCourse.ratingCount}
          lectures={courseLectures}
          schedule={getCourseSchedule(focusedCourse.title)}
          onStartLecture={(lectureId) => {
            setIsDetailsOpen(false);
            openInline(lectureId, focusedCourse.id);
          }}
        />
      )}

      <CourseCatalogSheet
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        enrolledCourseIds={enrolledCourseIds}
      />
    </DepthScene>
  );
}
