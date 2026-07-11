import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BookOpen, Folder } from 'lucide-react';
import type { Lecture } from '@/types/domain';
import type { Course } from '@/services/coursesService';
import { DepthScene, MediaRail, ConsoleTile } from '@/components/console';
import { splitLectureTitle } from '@/lib/utils';
import { topicIcon } from '@/lib/topicIcon';
import { InsightGarden } from './InsightGarden';
import { ProfessorAskBar } from '@/features/analytics/components/ProfessorAskBar';
import { useProfessorChat } from '@/features/analytics/components/useProfessorChat';

// Calm, slightly slower cover-flow glide for the analytics rails (Netflix/PS5
// feel) — used when the chat focuses a course/lecture on the right.
const RAIL_GLIDE = { type: 'tween' as const, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const };

// Calm, slightly slow scroll down to a revealed tier.
//
// We can't use Element.scrollIntoView here: a global `body { overflow-y: auto }`
// makes the body a scroll container as tall as its content, so the browser
// considers targets "already visible" and never scrolls the real viewport.
// Scrolling the window explicitly avoids that. The target is recomputed every
// frame so the easing tracks the tier's height/expand animation instead of
// aiming at a stale position.
function smoothScrollToEl(el: HTMLElement | null, offset = 96, duration = 750) {
  if (!el) return;
  const startY = window.scrollY;
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  let startTs: number | null = null;
  const step = (ts: number) => {
    if (startTs === null) startTs = ts;
    const p = Math.min(1, (ts - startTs) / duration);
    const targetY = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo(0, startY + (targetY - startY) * easeOutCubic(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

interface GardenLecturePickerProps {
  courses?: Course[];
  lectures: Lecture[];
  loading: boolean;
  selectedLectureId?: string;
  onSelectLecture: (id: string) => void;
  selectedCourseId?: string;
  onSelectCourse?: (id: string) => void;
}

export function GardenLecturePicker({
  courses = [],
  lectures,
  loading,
  selectedLectureId,
  onSelectLecture,
  selectedCourseId,
  onSelectCourse,
}: GardenLecturePickerProps) {
  const [courseIndex, setCourseIndex] = useState(0);
  const [lectureIndex, setLectureIndex] = useState(0);
  const [activeRail, setActiveRail] = useState<'courses' | 'lectures' | 'insights'>('courses');
  // When chat focuses a lecture, the course may change too — stash the target
  // lecture so the course-change reset applies it instead of snapping to 0.
  const pendingLectureRef = useRef<number | null>(null);
  // Sentinel at the very top of the non-chat flow: when it scrolls back into
  // view we collapse to the courses tier (and the ask bar reappears).
  const topSentinelRef = useRef<HTMLDivElement>(null);

  const enrichedCourses = useMemo(() => {
    const courseMap = new Map<string, Lecture[]>();
    courses.forEach(c => courseMap.set(c.id, []));

    const uncategorized: Lecture[] = [];

    lectures.forEach(l => {
      if (l.course_id && courseMap.has(l.course_id)) {
        courseMap.get(l.course_id)!.push(l);
      } else {
        uncategorized.push(l);
      }
    });

    // The service returns lectures newest-first; in the analytics rail the
    // professor expects them in the order they were created (first → last).
    // ISO timestamps sort lexicographically, so a string compare is enough.
    const byCreatedAsc = (a: Lecture, b: Lecture) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? '');
    courseMap.forEach(arr => arr.sort(byCreatedAsc));
    uncategorized.sort(byCreatedAsc);

    const result = courses.map(c => ({
      ...c,
      lectures: courseMap.get(c.id)!
    })).filter(c => c.lectures.length > 0);

    if (uncategorized.length > 0) {
      result.push({
        id: 'uncategorized',
        title: 'Uncategorized',
        description: 'Lectures without a course assignment',
        color: null,
        icon: null,
        is_archived: false,
        created_at: null,
        updated_at: null,
        lecture_count: uncategorized.length,
        professor_id: '',
        lectures: uncategorized
      });
    }
    return result;
  }, [courses, lectures]);

  // Reset lecture index when course changes (or apply a chat-pending target).
  useEffect(() => {
    if (pendingLectureRef.current != null) {
      setLectureIndex(pendingLectureRef.current);
      pendingLectureRef.current = null;
    } else {
      setLectureIndex(0);
    }
  }, [courseIndex]);

  // Synchronize internal state with selectedLectureId and selectedCourseId props
  useEffect(() => {
    if (selectedLectureId) {
      for (let ci = 0; ci < enrichedCourses.length; ci++) {
        const lecs = enrichedCourses[ci].lectures;
        const li = lecs.findIndex(l => l.id === selectedLectureId);
        if (li !== -1) {
          // When the selected lecture lives in a different course, route the
          // target index through pendingLectureRef. The [courseIndex] reset
          // effect would otherwise fire after setCourseIndex and snap
          // lectureIndex back to 0 — focusing the wrong lecture (the rail showed
          // the first lecture's title instead of the one you opened).
          if (ci !== courseIndex) {
            pendingLectureRef.current = li;
            setCourseIndex(ci);
          } else {
            setLectureIndex(li);
          }
          setActiveRail('insights');
          return;
        }
      }
    } else if (selectedCourseId) {
      const ci = enrichedCourses.findIndex(c => c.id === selectedCourseId);
      if (ci !== -1) {
        setCourseIndex(ci);
        setActiveRail('lectures');
      }
    } else {
      if (activeRail === 'insights') {
        setActiveRail('courses');
      }
    }
  }, [selectedLectureId, selectedCourseId, enrichedCourses]);


  // Global Up/Down arrow handler for switching rails
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't hijack keys while the user is typing (e.g. the ask bar).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeRail === 'courses') setActiveRail('lectures');
        else if (activeRail === 'lectures' && selectedLectureId) setActiveRail('insights');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeRail === 'insights') setActiveRail('lectures');
        else if (activeRail === 'lectures') setActiveRail('courses');
      } else if (e.key === 'Enter' && activeRail === 'courses') {
        e.preventDefault();
        setActiveRail('lectures');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeRail, selectedLectureId]);

  // Clicking a course reveals the lectures tier — smooth-scroll down to it
  // ("moved down a bit"; the offset leaves the courses tier peeking above).
  useEffect(() => {
    if (activeRail === 'lectures') {
      const id = window.setTimeout(() => {
        smoothScrollToEl(document.getElementById('lectures-section'));
      }, 360);
      return () => window.clearTimeout(id);
    }
  }, [activeRail]);

  // Selecting a lecture reveals its stats — smooth-scroll down to them.
  useEffect(() => {
    if (selectedLectureId) {
      setActiveRail('insights');
      const id = window.setTimeout(() => {
        smoothScrollToEl(document.getElementById('insights-section'));
      }, 360);
      return () => window.clearTimeout(id);
    }
  }, [selectedLectureId]);

  // Make the right-hand console react to what the professor asks: match the
  // message text against course/lecture titles and calmly focus the result.
  const handleAsk = useCallback(
    (text: string) => {
      const q = text.toLowerCase();
      // Lecture match first (more specific).
      for (let ci = 0; ci < enrichedCourses.length; ci++) {
        const lecs = enrichedCourses[ci].lectures;
        for (let li = 0; li < lecs.length; li++) {
          const { cleanTitle } = splitLectureTitle(lecs[li].title);
          const t = (cleanTitle || lecs[li].title || '').toLowerCase().trim();
          if (t.length >= 4 && q.includes(t)) {
            setActiveRail('lectures');
            if (ci === courseIndex) {
              setLectureIndex(li);
            } else {
              pendingLectureRef.current = li; // applied by the course-change effect
              setCourseIndex(ci);
            }
            return;
          }
        }
      }
      // Course match.
      for (let ci = 0; ci < enrichedCourses.length; ci++) {
        const t = (enrichedCourses[ci].title || '').toLowerCase().trim();
        if (t.length >= 3 && q.includes(t)) {
          setCourseIndex(ci);
          setActiveRail('courses');
          return;
        }
      }
    },
    [enrichedCourses, courseIndex],
  );

  const chat = useProfessorChat({ onAsk: handleAsk });
  const chatActive = chat.active;

  // Non-chat flow only: collapse back to the courses tier when the user
  // scrolls to the top (this also re-shows the ask bar). We never *push* a
  // scroll here — we only react to the user reaching the top.
  //
  // Crucially we ignore the observer's *initial* callback (which always reports
  // "intersecting" at mount, since we start at the top) and only collapse once
  // the sentinel has actually left the viewport at least once. Otherwise the
  // mount-time fire — and sitting at the top before the click-driven scroll has
  // moved us — would force 'courses' right after a course was selected,
  // collapsing the lectures tier and cancelling the scroll-down.
  useEffect(() => {
    if (chatActive) return;
    const el = topSentinelRef.current;
    if (!el) return;
    let hasLeft = false;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) hasLeft = true;
          else if (hasLeft) setActiveRail('courses');
        }
      },
      { threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [chatActive]);

  if (loading) {
    return (
      <DepthScene status="progress" gradientIndex={0}>
        <div className="relative min-h-screen flex flex-col justify-center items-center">
          <div className="h-32 w-1/2 rounded-3xl bg-white/[0.04] animate-pulse mb-8" />
          <div className="h-64 w-3/4 rounded-3xl bg-white/[0.04] animate-pulse" />
        </div>
      </DepthScene>
    );
  }

  if (enrichedCourses.length === 0) {
    return (
      <DepthScene status="progress" gradientIndex={0}>
        <div className="relative min-h-screen flex flex-col justify-center items-center">
          <div className="rounded-3xl border border-white/5 bg-white/[0.02] px-10 py-16 text-center glass-panel">
            <BookOpen className="mx-auto mb-5 h-12 w-12 text-white/25" />
            <p className="text-xl font-bold text-white tracking-tight">No lectures yet</p>
            <p className="mt-2 text-sm text-white/50">Upload a lecture to start seeing insights.</p>
          </div>
        </div>
      </DepthScene>
    );
  }

  // Ensure courseIndex is within bounds if data changes
  const safeCourseIndex = Math.min(courseIndex, Math.max(0, enrichedCourses.length - 1));
  const focusedCourse = enrichedCourses[safeCourseIndex];
  const focusedCourseLectures = focusedCourse?.lectures || [];

  // A course is "entered" once we leave the courses tier; a selected lecture
  // also keeps the lectures tier mounted so the structure stays consistent.
  const lecturesOpen = activeRail !== 'courses' || !!selectedLectureId;

  const hero = (
    <div className="px-6 lg:px-12 text-center z-10">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-[10px] font-black uppercase tracking-[0.4em] text-white/50 mb-4"
      >
        Course Insights
      </motion.p>
      <motion.h1
        key={focusedCourse.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-5xl lg:text-7xl font-black tracking-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.5)]"
      >
        {focusedCourse.title}
      </motion.h1>
      {focusedCourse.description && (
        <motion.p
          key={focusedCourse.id + 'desc'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mt-4 text-white/60 max-w-2xl mx-auto leading-relaxed"
        >
          {focusedCourse.description}
        </motion.p>
      )}
    </div>
  );

  const coursesRailEl = (
    <div className={`transition-all duration-500 ${activeRail === 'courses' ? 'opacity-100 scale-100' : 'opacity-40 scale-[0.98]'}`}>
      <MediaRail
        items={enrichedCourses}
        focused={safeCourseIndex}
        onFocus={(i) => {
          setCourseIndex(i);
          setActiveRail('courses');
        }}
        onActivate={(c) => {
          onSelectCourse?.(c.id);
          setActiveRail('lectures');
        }}
        getKey={(c) => c.id}
        enableKeyboard={activeRail === 'courses'}
        transition={RAIL_GLIDE}
        cardWidth={300}
        cardHeight={180}
        step={324}
        renderTile={(c, { isActive, index }) => (
          <ConsoleTile
            isActive={isActive}
            selection="ring"
            gradientIndex={index}
            title={c.title}
            progress={0}
            watermark={<Folder className="w-20 h-20 text-white/10" />}
            eyebrow={`${c.lectures.length} Lectures`}
          />
        )}
      />
    </div>
  );

  const lecturesRail = (
    <MediaRail
      items={focusedCourseLectures}
      focused={lectureIndex}
      onFocus={(i) => {
        setLectureIndex(i);
        setActiveRail('lectures');
        // Once stats are already open, browsing to another lecture should
        // refresh them immediately instead of requiring a second "activate".
        const lec = focusedCourseLectures[i];
        if (selectedLectureId && lec && lec.id !== selectedLectureId) {
          onSelectLecture(lec.id);
        }
      }}
      onActivate={(l) => onSelectLecture(l.id)}
      getKey={(l) => l.id}
      enableKeyboard={activeRail === 'lectures'}
      transition={RAIL_GLIDE}
      cardWidth={200}
      cardHeight={280}
      step={220}
      renderTile={(l, { isActive, index }) => {
        const { cleanTitle, badge } = splitLectureTitle(l.title);
        const LectureIcon = topicIcon(cleanTitle, l.id);
        return (
          <ConsoleTile
            isActive={isActive}
            selection="scale"
            gradientIndex={index}
            title={cleanTitle}
            progress={0}
            watermark={badge ?? <LectureIcon className="w-16 h-16 text-white/10" />}
          />
        );
      }}
    />
  );

  // Compact composition used by the two-pane chat layout (lectures inline).
  const heroAndRails = (
    <>
      {hero}
      {coursesRailEl}
      {activeRail !== 'courses' && (
        <div id="lectures-section" className={`transition-all duration-500 ${activeRail === 'lectures' ? 'opacity-100 scale-100' : 'opacity-40 scale-[0.98]'}`}>
          {lecturesRail}
        </div>
      )}
    </>
  );

  const insightsBlock = (
    <AnimatePresence>
      {selectedLectureId && (
        <motion.div
          id="insights-section"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.5 }}
          className="scroll-mt-24"
          onClick={() => setActiveRail('insights')}
        >
          <InsightGarden lectureId={selectedLectureId} inline={true} />
        </motion.div>
      )}
    </AnimatePresence>
  );

  const header = (
    <div className="px-6 lg:px-12 flex items-center justify-between z-10">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        <Link to="/professor/dashboard" className="transition-colors hover:text-white">
          Dashboard
        </Link>
        <span className="opacity-30">/</span>
        <span className="text-white">Insights</span>
      </div>
      <p className="text-xs font-bold text-white/50 uppercase tracking-widest flex gap-4">
        <span className={activeRail === 'courses' ? 'text-white' : ''}>1. COURSE</span>
        <span className="opacity-50">→</span>
        <span className={activeRail === 'lectures' ? 'text-white' : ''}>2. LECTURE</span>
        <span className="opacity-50">→</span>
        <span className={activeRail === 'insights' ? 'text-white' : ''}>3. INSIGHTS</span>
      </p>
    </div>
  );

  return (
    <DepthScene status="progress" gradientIndex={safeCourseIndex} motionKey={focusedCourse?.id}>
      {chatActive ? (
        // Two-pane: chat stays docked left; the console scrolls on the right.
        <div className="relative flex flex-col pt-12 h-[calc(100dvh-4.5rem)] overflow-hidden">
          {header}
          <div className="flex flex-1 min-h-0 gap-10 px-6 lg:px-12 pt-4">
            <aside className="hidden md:flex w-[21rem] xl:w-[25rem] shrink-0 flex-col">
              <ProfessorAskBar chat={chat} variant="panel" />
            </aside>
            <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar pr-1">
              <div className="flex min-h-full flex-col justify-center space-y-12 py-6">
                {heroAndRails}
              </div>
              {insightsBlock}
            </main>
          </div>
        </div>
      ) : (
        // Non-chat: a vertical drill-down. Courses (+ ask bar) fill the first
        // screen; clicking a course reveals the lectures tier below; clicking a
        // lecture reveals its stats below that. Scrolling back to the top
        // collapses the tiers and brings the ask bar back.
        <div className="relative pb-32">
          <div ref={topSentinelRef} className="pointer-events-none absolute top-0 left-0 h-24 w-full" aria-hidden />
          <div className="pt-12">{header}</div>

          {/* Tier 1 — Courses + ask bar */}
          <section className="flex min-h-[calc(100vh-7rem)] flex-col justify-center space-y-10">
            {hero}
            {coursesRailEl}
            <AnimatePresence>
              {!selectedLectureId && activeRail === 'courses' && (
                <motion.div
                  key="askbar"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={{ duration: 0.4 }}
                  className="pt-6"
                >
                  <ProfessorAskBar chat={chat} variant="idle" />
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Tier 2 — Lectures (revealed once a course is entered) */}
          <AnimatePresence>
            {lecturesOpen && (
              <motion.section
                key="lectures-tier"
                id="lectures-section"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="scroll-mt-24 overflow-hidden"
              >
                <div className={`flex min-h-[60vh] flex-col justify-center space-y-8 py-10 transition-opacity duration-300 ${activeRail === 'insights' ? 'opacity-60' : 'opacity-100'}`}>
                  <p className="px-6 text-center text-[10px] font-black uppercase tracking-[0.4em] text-white/40 lg:px-12">
                    Lectures in {focusedCourse.title}
                  </p>
                  {lecturesRail}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Tier 3 — Lecture stats */}
          {insightsBlock}
        </div>
      )}
    </DepthScene>
  );
}
