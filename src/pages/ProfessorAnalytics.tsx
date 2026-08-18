import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { fetchProfessorLectures } from '@/services/lectureService';
import { listCourses, type Course } from '@/services/coursesService';
import type { Lecture } from '@/types/domain';
import { GardenLecturePicker } from '@/features/analytics/garden/GardenLecturePicker';
import { toSlug } from '@/lib/utils';
import { logLearningEvent } from '@/services/studentService';

export default function ProfessorAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { lectureId } = useParams();

  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  // Bumped to force the load effect to re-run when the professor hits retry.
  const [retryTick, setRetryTick] = useState(0);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    void logLearningEvent(userId, 'analytics_dashboard_viewed', { surface: 'professor_analytics' });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setIsError(false);
      try {
        const [lecData, courseData] = await Promise.all([
          fetchProfessorLectures(userId),
          listCourses()
        ]);
        if (!cancelled) {
          setLectures(lecData);
          setCourses(courseData);
        }
      } catch (err) {
        // Distinguish a genuine load failure from a legitimately empty
        // picker — otherwise the fetch failing silently renders the same
        // "No lectures yet" empty state as a professor with zero lectures.
        if (!cancelled) {
          console.error('Failed to load professor analytics data', err);
          setLectures([]);
          setCourses([]);
          setIsError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, retryTick]);

  const handleRetry = () => setRetryTick((t) => t + 1);

  // Resolve route param lectureId against courses and lectures
  let resolvedLectureId: string | undefined = undefined;
  let resolvedCourseId: string | undefined = undefined;
  // R49: a deep link whose slug matches nothing (deleted/renamed lecture or
  // course) used to fall through every branch below with both ids left
  // undefined, silently rendering the course picker with no signal that the
  // link didn't resolve. Tracked explicitly so we can surface a notice.
  let notFound = false;

  if (lectureId && !loading) {
    if (lectureId === 'uncategorized') {
      resolvedCourseId = 'uncategorized';
    } else {
      const courseByUuid = courses.find(c => c.id === lectureId);
      if (courseByUuid) {
        resolvedCourseId = courseByUuid.id;
      } else {
        const courseBySlug = courses.find(c => toSlug(c.title) === lectureId);
        if (courseBySlug) {
          resolvedCourseId = courseBySlug.id;
        } else {
          const lectureByUuid = lectures.find(l => l.id === lectureId);
          if (lectureByUuid) {
            resolvedLectureId = lectureByUuid.id;
            resolvedCourseId = lectureByUuid.course_id || undefined;
          } else {
            const lectureBySlug = lectures.find(l => toSlug(l.title) === lectureId);
            if (lectureBySlug) {
              resolvedLectureId = lectureBySlug.id;
              resolvedCourseId = lectureBySlug.course_id || undefined;
            } else {
              notFound = true;
            }
          }
        }
      }
    }
  }

  return (
    <>
      {notFound && (
        <div
          role="alert"
          data-testid="analytics-deep-link-not-found"
          className="relative z-20 mx-auto mt-4 max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm font-semibold text-amber-200"
        >
          We couldn't find that lecture or course — it may have been renamed, deleted, or archived. Showing your course overview instead.
        </div>
      )}
      <GardenLecturePicker
        courses={courses}
        lectures={lectures}
        loading={loading}
        isError={isError}
        onRetry={handleRetry}
        selectedLectureId={resolvedLectureId}
        selectedCourseId={resolvedCourseId}
        onSelectLecture={(id) => {
          const lecture = lectures.find(l => l.id === id);
          if (lecture) {
            const slug = toSlug(lecture.title);
            if (slug === lectureId) {
              navigate('/professor/analytics');
            } else {
              navigate(`/professor/analytics/${slug}`);
            }
          } else {
            navigate('/professor/analytics');
          }
        }}
        onSelectCourse={(id) => {
          if (id === 'uncategorized') {
            navigate('/professor/analytics/uncategorized');
          } else {
            const course = courses.find(c => c.id === id);
            if (course) {
              navigate(`/professor/analytics/${toSlug(course.title)}`);
            }
          }
        }}
      />
    </>
  );
}
