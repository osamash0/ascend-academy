/**
 * One shape for the `ai_tutor_query` learning event, used by every tutor
 * surface. The question is stored (bounded) because the people who maintain
 * a Space read it to see where learners get stuck; the model's reply is
 * never stored — it is derivable from the lesson and only inflated the row.
 */
export const TUTOR_QUERY_MAX_CHARS = 500;

export interface TutorQueryEventInput {
  lectureId: string | undefined;
  slideId?: string | null;
  slideTitle?: string | null;
  sessionId: string;
  query: string;
}

export type TutorQueryEvent = {
  lectureId: string | undefined;
  slideId?: string | null;
  slideTitle?: string | null;
  sessionId: string;
  query: string;
  timestamp: string;
};

export function buildTutorQueryEvent(input: TutorQueryEventInput): TutorQueryEvent {
  return {
    lectureId: input.lectureId,
    slideId: input.slideId,
    slideTitle: input.slideTitle,
    sessionId: input.sessionId,
    query: input.query.slice(0, TUTOR_QUERY_MAX_CHARS),
    timestamp: new Date().toISOString(),
  };
}
