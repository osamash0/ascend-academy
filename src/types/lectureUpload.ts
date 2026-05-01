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
