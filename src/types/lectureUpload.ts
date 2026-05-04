export interface SlideData {
  title: string;
  content: string;
  summary: string;
  questions: QuestionData[];
}

export interface QuestionData {
  question: string;
  options: string[];
  correctAnswer: number;
  /** One-sentence justification for the correct option (concept-testing prompt). */
  explanation?: string;
  /** Concept the question is testing (e.g. proposed_title from the planner). */
  concept?: string;
  /** Cognitive level targeted by the question. */
  cognitive_level?: 'recall' | 'apply' | 'analyse';
}

/**
 * A single cross-slide quiz item from the deck-complete SSE event. Carries
 * 0-based ``linked_slides`` indices the question depends on; persistence
 * anchors the row to the first linked slide and stores the full list in
 * ``quiz_questions.metadata.linked_slides`` for the UI to render chips.
 */
export interface DeckQuizItem {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
  concept?: string;
  linked_slides: number[];
}

export interface SlideStatus {
  hasTitle: boolean;
  hasContent: boolean;
  hasSummary: boolean;
  hasQuiz: boolean;
}

export function getSlideStatus(slide: SlideData): SlideStatus {
  return {
    hasTitle: slide.title.trim().length > 0,
    hasContent: slide.content.trim().length > 0,
    hasSummary: slide.summary.trim().length > 0,
    hasQuiz: slide.questions.some(
      q => q.question.trim().length > 0 && q.options.some(o => o.trim().length > 0)
    ),
  };
}

export function getCompletionPercent(status: SlideStatus): number {
  const values = Object.values(status);
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

export function getOverallCompletion(slides: SlideData[]): number {
  if (slides.length === 0) return 0;
  const total = slides.reduce(
    (acc, s) => acc + getCompletionPercent(getSlideStatus(s)),
    0
  );
  return Math.round(total / slides.length);
}
