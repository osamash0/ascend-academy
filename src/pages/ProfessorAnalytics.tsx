import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { fetchProfessorLectures } from '@/services/lectureService';
import { listCourses, type Course } from '@/services/coursesService';
import type { Lecture } from '@/types/domain';
import { GardenLecturePicker } from '@/features/analytics/garden/GardenLecturePicker';
import { toSlug } from '@/lib/utils';

export default function ProfessorAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { lectureId } = useParams();

  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
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
        if (!cancelled) {
          setLectures([]);
          setCourses([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Resolve route param lectureId against courses and lectures
  let resolvedLectureId: string | undefined = undefined;
  let resolvedCourseId: string | undefined = undefined;

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
            }
          }
        }
      }
    }
  }

  return (
    <GardenLecturePicker
      courses={courses}
      lectures={lectures}
      loading={loading}
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
  );
}
