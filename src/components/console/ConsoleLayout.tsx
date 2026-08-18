import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { CommandPalette } from '@/components/CommandPalette';
import { FEATURES } from '@/lib/featureFlags';
import { ConsoleTopBar } from './ConsoleTopBar';
import { ConsoleBoot } from './ConsoleBoot';
import { useAuth } from '@/lib/auth';
import { StudentRoutes, ProfessorRoutes, AdminRoutes } from '@/lib/routes';
import { splitLectureTitle } from '@/lib/utils';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import React from 'react';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

interface ConsoleLayoutProps {
  children: ReactNode;
}

/**
 * Left-to-right order of the top-bar tabs. Switching to a tab further right
 * slides the new screen in from the right (and vice-versa), mirroring the PS5
 * home tab transition. Course-scoped library deep-links sit with the library.
 */
const TAB_ORDER = [
  '/dashboard', '/library', '/materials', '/course-v3', '/course', '/achievements', '/leaderboard', '/insights',
  '/professor/dashboard', '/professor/courses', '/professor/archive', '/professor/analytics', '/professor/upload'
];

// Matches a bare UUID route param (course id, lecture id, exam id, ...).
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Generic fallback label keyed by the segment immediately preceding the id,
// used when no cheap title lookup is available (e.g. professor analytics,
// which fetches via plain useState/useEffect rather than React Query, so
// there's no shared cache ConsoleLayout can read without a fresh fetch).
const GENERIC_ID_LABEL: Record<string, string> = {
  course: 'Course',
  'course-v3': 'Course',
  courses: 'Course',
  exam: 'Course', // :courseId under /exam — "Exam" is already the parent crumb
  analytics: 'Lecture',
  lecture: 'Lecture',
};

interface CachedTitledEntity {
  id: string;
  title?: string | null;
  course?: { id: string; title?: string | null } | null;
}

/**
 * Full-bleed console "OS" shell: a persistent top-bar nav over a deep base,
 * with PS5-style directional screen transitions between tabs.
 */
export function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const homeRoute = role === 'admin' ? AdminRoutes.DASHBOARD : (role === 'professor' ? ProfessorRoutes.DASHBOARD : StudentRoutes.HOME);

  // Resolve a dynamic route id (course/lecture UUID) to its real title using
  // data already sitting in the React Query cache from the page that's
  // currently rendering below (the student dashboard's ['student-courses']
  // / ['student-lectures'] queries) — no extra network fetch just for a
  // breadcrumb. Returns null when nothing cached matches, so the caller can
  // fall back to a generic (non-UUID) label instead of the raw id.
  const resolveIdTitle = useCallback((id: string): string | null => {
    const courses = queryClient.getQueryData<CachedTitledEntity[]>(['student-courses']);
    const courseMatch = courses?.find((c) => c.id === id);
    if (courseMatch?.title) return courseMatch.title;

    const lectures = queryClient.getQueryData<CachedTitledEntity[]>(['student-lectures']);
    const lectureMatch = lectures?.find((l) => l.id === id);
    if (lectureMatch?.title) return splitLectureTitle(lectureMatch.title).cleanTitle;
    if (lectureMatch?.course?.title) return lectureMatch.course.title;

    return null;
  }, [queryClient]);

  // Key the screen by TAB, not the full pathname, so intra-tab navigation
  // (e.g. /professor/analytics → /professor/analytics/:id) updates in place
  // instead of remounting/refetching the whole screen. Switching tabs changes
  // the key, which remounts the new screen and plays its fade-in.
  const tabKey = TAB_ORDER.find((p) => location.pathname.startsWith(p)) ?? location.pathname;

  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!FEATURES.globalSearch) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  return (
    <div className="console-bg relative min-h-screen flex flex-col text-foreground selection:bg-primary/20">
      <ConsoleBoot />
      <ConsoleTopBar onOpenSearch={FEATURES.globalSearch ? openPalette : undefined} />
      {location.pathname !== homeRoute && (
        <div className="px-5 lg:px-10 py-3 bg-gradient-to-b from-[#070b14]/30 to-transparent border-b border-white/5 z-30 relative backdrop-blur-sm">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href={homeRoute}>Home</BreadcrumbLink>
              </BreadcrumbItem>
              {location.pathname.split('/').filter(Boolean).map((path, index, arr) => {
                const href = `/${arr.slice(0, index + 1).join('/')}`;
                const isLast = index === arr.length - 1;

                // Skip redundant "Home" or "Dashboard" if it's already the root
                if (index === 0 && (path === 'dashboard' || path === 'professor')) return null;
                if (index === 1 && path === 'dashboard' && arr[0] === 'professor') return null;

                // Dynamic route params (course/lecture UUIDs) render as the
                // literal id otherwise — resolve to a real title from
                // whatever's already cached, or fall back to a generic,
                // non-UUID label (M42).
                let formattedPath: string;
                if (UUID_SEGMENT.test(path)) {
                  const resolved = resolveIdTitle(path);
                  formattedPath = resolved ?? GENERIC_ID_LABEL[arr[index - 1]] ?? 'Details';
                } else {
                  // Format path text: capitalize and replace hyphens with spaces
                  formattedPath = path.charAt(0).toUpperCase() + path.slice(1).replace(/-/g, ' ');
                }

                return (
                  <React.Fragment key={href}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{formattedPath}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink href={href}>{formattedPath}</BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      )}
      {/* Keyed fade, NOT AnimatePresence mode="wait": each tab remounts on key
          change and fades in on its own. The previous mode="wait" transition
          could deadlock (the exiting screen's exit-complete never firing when
          the per-route layout reconciled), leaving the new screen's content
          permanently unmounted — a blank content area under an intact shell. */}
      <motion.main
        key={tabKey}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="flex-1 relative"
      >
        {/* Suspense INSIDE the shell: a lazy page load shows a contained loader
            in the content area instead of letting the outer (whole-app)
            Suspense swap the entire shell for a full-screen loader (the black
            flash). */}
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-32">
              <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin shadow-glow-primary" />
            </div>
          }
        >
          {children}
        </Suspense>
      </motion.main>
      <FeedbackWidget />
      {FEATURES.globalSearch && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </div>
  );
}
