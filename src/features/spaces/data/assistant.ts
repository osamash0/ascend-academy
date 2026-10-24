import { askSuggestions as fixtureSuggestions } from '../mocks/assistant';
import { homeFromWorld } from './home';
import { liveWorld } from './world';
import type { Phrase } from './phrases';

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
export function askSuggestionsNow(): readonly Phrase[] {
  const world = liveWorld();
  if (!world) return fixtureSuggestions;
  const home = homeFromWorld(world);
  const space = world.spaces.find((s) => s.viewerRole !== null && s.state === 'active');
  const asks: (Phrase | null)[] = [
    { key: 'v4Spaces:home.ask.reviewFirst' },
    home.next ? { key: 'v4Spaces:home.ask.explainSimply', values: { lesson: home.next.lessonTitle } } : null,
    space ? { key: 'v4Spaces:home.ask.quizMe', values: { space: space.name } } : null,
  ];
  return asks.filter((s): s is Phrase => s !== null);
}
