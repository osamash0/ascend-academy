import * as fixtures from '../mocks/contributions';
import type { Contribution } from '../types';
import { liveWorld } from './world';

/**
 * Contributions — what members publish into a Space — and the helpers that
 * draw them.
 *
 * There is no contributions table yet, so live mode has none: every live list
 * of them is empty, and these helpers only ever meet fixture contributions.
 * When contributions get a backend, this file is where the live side goes.
 */
export { resolveContributionAnchor } from '../mocks/library';
export { likeCount, visibleContributions } from '../mocks/engagement';
export { anchorFor, isOrphaned } from '../mocks/reanchor';

export const contributionsForLesson = (lessonId: string): Contribution[] =>
  liveWorld() ? [] : fixtures.contributionsForLesson(lessonId);

export const contributionsForSpace = (spaceId: string): Contribution[] =>
  liveWorld() ? [] : fixtures.contributionsForSpace(spaceId);
