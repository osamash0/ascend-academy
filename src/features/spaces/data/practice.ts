import { useEffect, useState } from 'react';
import { practiceForLesson, type PracticeQuestion } from '../mocks/practice';
import type { LoadState } from '../types';
import { loadLiveRepository } from './liveRepository';

export { gradeAnswer, type Graded, type PracticeQuestion } from '../mocks/practice';

/**
 * A Lesson's practice questions.
 *
 * Demo: the fixture bank. Live: the lecture's real quiz questions, fetched
 * once per Lesson per visit. A failed fetch is an error state, never the
 * fixture bank standing in for the real one.
 */
const cache = new Map<string, Promise<PracticeQuestion[]>>();

export function usePracticeQuestions(
  lessonId: string | undefined,
  live: boolean,
): { state: LoadState; questions: PracticeQuestion[] } {
  const [result, setResult] = useState<{ state: LoadState; questions: PracticeQuestion[] }>(() =>
    live || !lessonId
      ? { state: 'loading', questions: [] }
      : { state: 'ready', questions: practiceForLesson(lessonId) },
  );

  useEffect(() => {
    if (!lessonId) return;
    if (!live) {
      setResult({ state: 'ready', questions: practiceForLesson(lessonId) });
      return;
    }
    let alive = true;
    if (!cache.has(lessonId)) {
      cache.set(
        lessonId,
        loadLiveRepository()
          .then((repo) => repo.practice(lessonId))
          .then((r) => r.questions),
      );
    }
    cache
      .get(lessonId)!
      .then((questions) => alive && setResult({ state: questions.length ? 'ready' : 'empty', questions }))
      .catch(() => {
        cache.delete(lessonId);
        if (alive) setResult({ state: 'error', questions: [] });
      });
    return () => {
      alive = false;
    };
  }, [lessonId, live]);

  return result;
}

/** What the server made of an answer: its grade, and the XP it granted (0 after the first time). */
export interface ServerGrade {
  correct: boolean;
  xp: number;
}

/** Live only: grade on the server, log the attempt, grant XP once per question. */
export async function submitAnswer(lessonId: string, questionId: string, answer: string): Promise<ServerGrade> {
  const repo = await loadLiveRepository();
  return repo.answerPractice(lessonId, questionId, answer);
}
