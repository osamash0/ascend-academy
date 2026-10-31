import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { practiceForLesson, type PracticeQuestion } from '../mocks/practice';
import type { LoadState } from '../types';
import { loadLiveRepository } from './liveRepository';
import { currentSession } from './readingSession';

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
  armed = true,
): { state: LoadState; questions: PracticeQuestion[] } {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'en').split('-')[0];
  const key = `${lessonId}:${lang}`;
  const [result, setResult] = useState<{ key: string; state: LoadState; questions: PracticeQuestion[] }>(() =>
    live || !lessonId
      ? { key, state: 'loading', questions: [] }
      : { key, state: 'ready', questions: practiceForLesson(lessonId) },
  );

  useEffect(() => {
    if (!lessonId || !armed) return;
    if (!live) {
      setResult({ key, state: 'ready', questions: practiceForLesson(lessonId) });
      return;
    }
    let alive = true;
    if (!cache.has(key)) {
      cache.set(
        key,
        loadLiveRepository()
          .then((repo) => repo.practice(lessonId, lang))
          .then((r) => r.questions),
      );
    }
    cache
      .get(key)!
      .then((questions) => {
        /* An empty answer is not kept: a Lesson still being read may have questions later. */
        if (questions.length === 0) cache.delete(key);
        if (alive) setResult({ key, state: questions.length ? 'ready' : 'empty', questions });
      })
      .catch(() => {
        cache.delete(key);
        if (alive) setResult({ key, state: 'error', questions: [] });
      });
    return () => {
      alive = false;
    };
  }, [lessonId, live, armed, key, lang]);

  return result.key === key ? result : { state: 'loading', questions: [] };
}

/** What the server made of an answer: its grade, and the XP it granted (0 after the first time). */
export interface ServerGrade {
  correct: boolean;
  xp: number;
}

/** Live only: grade on the server, log the attempt, grant XP once per question. */
export async function submitAnswer(lessonId: string, question: PracticeQuestion, answer: string): Promise<ServerGrade> {
  const repo = await loadLiveRepository();
  const index = question.choices.indexOf(answer);
  const canonical = question.answerValues?.[index] ?? answer;
  return repo.answerPractice(lessonId, question.id, canonical, currentSession(lessonId));
}
