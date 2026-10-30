import type { ReactNode } from 'react';

/**
 * The course tutor's reply, as prose (LS-104).
 *
 * The tutor cites with `[Source N]` (backend/services/ai/prompts.py), and the
 * citations already come back as Lesson-page chips under the reply, so the
 * markers are dropped from the sentence. It writes `**bold**` for headings
 * like "Question 1:" and `*emphasis*` in explanations; only those two marks
 * are honoured. This is prose, not a Markdown surface.
 */
const SOURCES = /[ \t]*\[(?:Source|Quelle)\s*\d+(?:\s*[,;]\s*(?:Source|Quelle)?\s*\d+)*\]/gi;

export const withoutSources = (text: string): string => text.replace(SOURCES, '');

const emphasis = (text: string, key: string): ReactNode[] =>
  text.split(/\*([^*\n]+)\*/g).map((part, i) => (i % 2 ? <em key={`${key}-${i}`}>{part}</em> : part));

export function tutorReply(text: string): ReactNode[] {
  return withoutSources(text)
    .split(/\*\*([^*\n]+)\*\*/g)
    .flatMap((part, i): ReactNode[] => (i % 2 ? [<strong key={i}>{part}</strong>] : emphasis(part, String(i))));
}
