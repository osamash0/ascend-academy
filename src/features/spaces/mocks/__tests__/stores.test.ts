import { beforeEach, describe, expect, it } from 'vitest';
import {
  isLiked,
  isStarred,
  likeCount,
  resetEngagement,
  starCount,
  toggleLike,
  toggleStar,
} from '../engagement';
import {
  acceptRequest,
  currentFriends,
  currentRequests,
  declineRequest,
  isFriend,
  resetSocial,
} from '../social';
import { addLesson, lessonsForSpace, resetAddedLessons } from '../lessons';
import {
  addContribution,
  contributionsForSpace,
  resetAddedContributions,
} from '../contributions';
import { addNote, allNotes, resetNotes } from '../notes';
import { viewer, keller } from '../people';
import { normalizationContributions } from '../contributions';
import { allSpaces } from '../spaces';

/**
 * The writable stores, and the reset seams that had never run.
 *
 * `resetEngagement` and `resetSocial` were exported, labelled "Test seam —
 * these are mutable, so each test starts from the fixtures", and **never
 * called anywhere in the repo**. So the statement was false: the first test to
 * like something would have leaked into every test after it in the same
 * worker, and nothing would have failed — the next test would simply have
 * started from a different world.
 *
 * This file is the thing that makes the label true. It also exercises each
 * store, which nothing did: `visible-work.test.ts` imports only the two pure
 * functions from `engagement.ts` and never touches the mutable state.
 */

beforeEach(() => {
  resetEngagement();
  resetSocial();
  resetAddedLessons();
  resetAddedContributions();
  resetNotes();
});

describe('likes', () => {
  const c = normalizationContributions[0]; // Åsa's, liked by the viewer in the seed

  it('starts from the fixture', () => {
    expect(isLiked(c.id)).toBe(c.likedByViewer);
    expect(likeCount(c.id)).toBe(c.likeCount);
  });

  it('toggles both ways and moves the count with it', () => {
    const before = likeCount(c.id);
    toggleLike(c.id, c.author.id);
    expect(isLiked(c.id)).toBe(!c.likedByViewer);
    expect(likeCount(c.id)).toBe(before + (c.likedByViewer ? -1 : 1));
    toggleLike(c.id, c.author.id);
    expect(likeCount(c.id)).toBe(before);
  });

  it('refuses your own work, in the data and not only in the button', () => {
    // Engagement rule 3. Enforced here so a second call site cannot forget.
    const mine = normalizationContributions.find((x) => x.author.id === viewer.id)!;
    const before = likeCount(mine.id);
    toggleLike(mine.id, viewer.id);
    expect(likeCount(mine.id)).toBe(before);
    expect(isLiked(mine.id)).toBe(false);
  });

  it('never goes below zero', () => {
    const unliked = normalizationContributions.find((x) => !x.likedByViewer)!;
    toggleLike(unliked.id, unliked.author.id);
    toggleLike(unliked.id, unliked.author.id);
    expect(likeCount(unliked.id)).toBeGreaterThanOrEqual(0);
  });
});

describe('stars', () => {
  const starred = allSpaces.find((s) => s.starredByViewer && s.viewerRole !== 'owner')!;

  it('starts from the fixture', () => {
    expect(isStarred(starred.id)).toBe(true);
    expect(starCount(starred.id)).toBe(starred.starCount);
  });

  it('toggles and moves the count', () => {
    toggleStar(starred.id, false);
    expect(isStarred(starred.id)).toBe(false);
    expect(starCount(starred.id)).toBe(starred.starCount - 1);
  });

  it('refuses your own Space', () => {
    const own = allSpaces.find((s) => s.viewerRole === 'owner')!;
    const before = starCount(own.id);
    toggleStar(own.id, true);
    expect(starCount(own.id)).toBe(before);
  });
});

describe('friends and requests', () => {
  it('accepting moves the person across', () => {
    const req = currentRequests()[0];
    expect(req).toBeDefined();
    const friendsBefore = currentFriends().length;
    acceptRequest(req.person.id);
    expect(currentRequests().some((r) => r.person.id === req.person.id)).toBe(false);
    expect(currentFriends()).toHaveLength(friendsBefore + 1);
    expect(isFriend(req.person.id)).toBe(true);
  });

  it('declining drops it and adds nobody', () => {
    const req = currentRequests()[0];
    const friendsBefore = currentFriends().length;
    declineRequest(req.person.id);
    expect(currentRequests()).toHaveLength(0);
    expect(currentFriends()).toHaveLength(friendsBefore);
    expect(isFriend(req.person.id)).toBe(false);
  });

  it('accepting twice does not duplicate them', () => {
    const req = currentRequests()[0];
    acceptRequest(req.person.id);
    acceptRequest(req.person.id);
    expect(currentFriends().filter((f) => f.id === req.person.id)).toHaveLength(1);
  });
});

describe('every store actually resets', () => {
  /*
   * The point of the file. Each of these writes, then resets, then asserts the
   * world is back — which is the only way the "test seam" label becomes true.
   */
  it('engagement', () => {
    const c = normalizationContributions[0];
    const before = likeCount(c.id);
    toggleLike(c.id, c.author.id);
    resetEngagement();
    expect(likeCount(c.id)).toBe(before);
  });

  it('social', () => {
    const before = currentFriends().length;
    acceptRequest(currentRequests()[0].person.id);
    resetSocial();
    expect(currentFriends()).toHaveLength(before);
    expect(currentRequests()).toHaveLength(1);
  });

  it('added Lessons', () => {
    const before = lessonsForSpace('s-linalg').length;
    addLesson('s-linalg', 'A session Lesson', viewer);
    expect(lessonsForSpace('s-linalg')).toHaveLength(before + 1);
    resetAddedLessons();
    expect(lessonsForSpace('s-linalg')).toHaveLength(before);
  });

  it('added contributions', () => {
    const before = contributionsForSpace('s-dbs').length;
    addContribution({
      title: 'A session contribution',
      excerpt: 'Something useful.',
      type: 'text',
      anchor: { level: 'space', spaceId: 's-dbs' },
      author: keller,
      grounding: null,
    });
    expect(contributionsForSpace('s-dbs')).toHaveLength(before + 1);
    resetAddedContributions();
    expect(contributionsForSpace('s-dbs')).toHaveLength(before);
  });

  it('notes', () => {
    const before = allNotes().length;
    addNote({ lessonId: '', body: 'A session note, written for the test.' });
    expect(allNotes()).toHaveLength(before + 1);
    resetNotes();
    expect(allNotes()).toHaveLength(before);
  });
});
