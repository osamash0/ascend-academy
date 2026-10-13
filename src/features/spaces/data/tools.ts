import * as fixtures from '../mocks/explain';
import type { ExplainAnswer } from '../components/reader/iui/spec';
import { liveWorld } from './world';

/** A Lesson's reading tools, as the tool shelf draws them. */
export type { LessonTool } from '../mocks/explain';

/**
 * Hand-written Explain answers and the tools they carry.
 *
 * They exist for one fixture Lesson. A real lecture has none: its answers are
 * composed by the model, page by page, through the reader — so live mode says
 * "none" here rather than letting a fixture id lookup say it by accident.
 */
export function toolsFor(lessonId: string): fixtures.LessonTool[] {
  return liveWorld() ? [] : fixtures.toolsFor(lessonId);
}

export function authoredFor(lessonId: string, page: number): ExplainAnswer | null {
  return liveWorld() ? null : fixtures.authoredFor(lessonId, page);
}
