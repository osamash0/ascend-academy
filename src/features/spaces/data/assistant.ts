import { askSuggestions as fixtureSuggestions } from '../mocks/assistant';
import { homeFromWorld } from './home';
import { liveWorld } from './world';

export { askAcknowledgement, askModel } from '../mocks/assistant';

export interface AskAnswer {
  reply: string;
  /** False when the course's slides did not cover it — the reply says so. */
  grounded: boolean;
  citations: { lessonId: string; lessonTitle: string | null; page: number }[];
  spaceId: string | null;
  spaceName: string | null;
}

/** Live only: the grounded course tutor, in the Space you are working in. */
export async function askNow(question: string): Promise<AskAnswer> {
  const { loadLiveRepository } = await import('./liveRepository');
  return (await loadLiveRepository()).ask(question);
}

/**
 * What the ask bar offers to ask.
 *
 * Demo: the fixtures. Live: about what this person is actually doing — the
 * Lesson they are on and a Space they are in — so the bar never suggests
 * quizzing someone on a course they have never seen.
 */
export function askSuggestionsNow(): readonly string[] {
  const world = liveWorld();
  if (!world) return fixtureSuggestions;
  const home = homeFromWorld(world);
  const space = world.spaces.find((s) => s.viewerRole !== null && s.state === 'active');
  return [
    'What should I review first?',
    home.next ? `Explain ${home.next.lessonTitle} more simply` : null,
    space ? `Quiz me on ${space.name}` : null,
  ].filter((s): s is string => s !== null);
}
