import { Clock, BookOpen, Play, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { RecentItem } from '@/features/student/homeFeed';

interface RecentlyViewedProps {
  items: RecentItem[];
  /** Called when the user clicks a lecture entry (passes lecture id). */
  onOpenLecture: (lectureId: string, lastSlide?: number | null) => void;
  /** Called when the user clicks a course entry (passes course id). */
  onOpenCourse: (courseId: string) => void;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

/**
 * "Recently Viewed" — a compact MRF-ordered list of up to 5 recently
 * interacted lectures and courses.
 *
 * Design contract:
 *   - Uses the same `depth-card` glass token as BentoGrid cells \u2014 no new styles.
 *   - Items shown here are NEVER shown in the Hero or Continue Learning rail
 *     (deduplication is enforced upstream in buildRecentlyViewed()).
 *   - Renders nothing when the list is empty (new student).
 */
export function RecentlyViewed({ items, onOpenLecture, onOpenCourse }: RecentlyViewedProps) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      {/* Section header — same pattern as SectionHeader from the console kit */}
      <div className="flex items-center gap-2.5">
        <Clock className="h-4 w-4 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">
          Recently Viewed
        </span>
      </div>

      <div className="depth-card divide-y divide-white/[0.06] overflow-hidden">
        {items.map((item, i) => (
          <motion.button
            key={item.kind === 'lecture' ? item.lectureView!.lecture.id : item.courseEntry!.courseId}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="console-focusable group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.04] outline-none focus-visible:bg-white/[0.06]"
            onClick={() => {
              if (item.kind === 'lecture') {
                onOpenLecture(
                  item.lectureView!.lecture.id,
                  item.lectureView!.progress?.last_slide_viewed,
                );
              } else {
                onOpenCourse(item.courseEntry!.courseId);
              }
            }}
            aria-label={
              item.kind === 'lecture'
                ? `Resume ${item.lectureView!.cleanTitle}`
                : `Open ${item.courseEntry!.title}`
            }
          >
            {/* Icon badge */}
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                item.kind === 'lecture'
                  ? 'bg-gradient-to-br from-primary/30 to-secondary/30'
                  : 'bg-gradient-to-br from-white/10 to-white/5',
              )}
              style={
                item.kind === 'course' && item.courseEntry?.color
                  ? { background: `linear-gradient(135deg, ${item.courseEntry.color}40, ${item.courseEntry.color}15)` }
                  : undefined
              }
            >
              {item.kind === 'lecture' ? (
                <Play className="h-4 w-4 fill-primary text-primary" />
              ) : (
                <BookOpen className="h-4 w-4 text-white/60" />
              )}
            </div>

            {/* Label + meta */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight text-white/90">
                {item.kind === 'lecture'
                  ? item.lectureView!.cleanTitle
                  : item.courseEntry!.title}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/40">
                {item.kind === 'lecture' ? (
                  <>
                    {item.lectureView!.lecture.course?.title && (
                      <span className="truncate">{item.lectureView!.lecture.course.title}</span>
                    )}
                    {item.lectureView!.lecture.course?.title && <span>&middot;</span>}
                    <span>{item.lectureView!.pct}% done</span>
                    {item.lectureView!.progress?.last_slide_viewed &&
                      item.lectureView!.progress.last_slide_viewed > 0 && (
                        <>
                          <span>&middot;</span>
                          <span>Slide {item.lectureView!.progress.last_slide_viewed}</span>
                        </>
                      )}
                  </>
                ) : (
                  <>
                    <span>
                      {item.courseEntry!.completedLectures}/{item.courseEntry!.totalLectures} lectures
                    </span>
                  </>
                )}
                <span className="ml-auto shrink-0">
                  {relativeTime(item.lastTouchedAt)}
                </span>
              </div>
            </div>

            {/* Chevron */}
            <ChevronRight className="h-4 w-4 shrink-0 text-white/20 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-white/40" />
          </motion.button>
        ))}
      </div>
    </section>
  );
}
