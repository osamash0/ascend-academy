import { Navigate, useLocation, useParams } from 'react-router-dom';
import { locateLesson } from '../data/world';
import NotFoundScreen from './NotFoundScreen';

/**
 * `/v4/lesson/:lessonId` — a Lesson by its id alone (LS-050).
 *
 * Old links name a lecture without its course (`/lecture/:id`). A v4 Lesson
 * lives under its Space, so this looks the Space up in the world and goes
 * there, keeping any query (`?page=3`). A Lesson the viewer cannot see is not
 * in the world, so it says so on the stage rather than guessing.
 */
export default function LessonLinkRoute() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const { search } = useLocation();
  const found = lessonId ? locateLesson(lessonId) : undefined;
  if (!found) return <NotFoundScreen />;
  return <Navigate to={`/v4/space/${found.spaceId}/lesson/${lessonId}${search}`} replace />;
}
