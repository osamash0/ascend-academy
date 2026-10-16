import { afterEach, describe, expect, it } from 'vitest';
import { conceptById, contributionsForConcept } from '../data/concepts';
import { contributionsForLesson, contributionsForSpace } from '../data/contributions';
import { authoredFor, toolsFor } from '../data/tools';
import * as fixtures from '../mocks/concepts';
import { setLiveWorld } from '../data/world';
import type { Lesson } from '../types';
import { emptyWorld } from './emptyWorld';

const lesson = (spaceId: string, order: number, concepts: Lesson['concepts']) =>
  ({ id: `${spaceId}-${order}`, spaceId, order, title: `L${order}`, state: 'published', concepts }) as Lesson;

afterEach(() => setLiveWorld(null));

describe('an idea, live', () => {
  it('demo is the fixture concept', () => {
    const any = fixtures.allConcepts()[0];
    expect(conceptById(any.id)).toEqual(any);
  });

  it('gathers every Lesson in the Space that teaches the shared concept id', () => {
    const keys = { id: 'c-keys', name: 'Keys', progress: 'discovered' as const };
    setLiveWorld(emptyWorld({
      lessons: [
        lesson('dbs', 4, [{ id: 'c-nf', name: 'Normal forms', progress: 'untouched' }, keys]),
        lesson('dbs', 2, [keys]),
        lesson('other', 1, [keys]),
      ],
    }));
    const c = conceptById('c-keys', 'dbs')!;
    expect(c.lessonIds).toEqual(['dbs-2', 'dbs-4']); // path order, this Space only
    expect(c).toMatchObject({ name: 'Keys', progress: 'discovered', spaceId: 'dbs', weight: 1 });
    expect(conceptById('c-keys', 'nowhere')).toBeUndefined();
  });

  it('live has no contributions and no hand-written answers', () => {
    setLiveWorld(emptyWorld());
    expect(contributionsForConcept('c-keys')).toEqual([]);
    expect(contributionsForLesson('l-s-dbs-4')).toEqual([]);
    expect(contributionsForSpace('s-dbs')).toEqual([]);
    expect(toolsFor('l-s-dbs-4')).toEqual([]);
    expect(authoredFor('l-s-dbs-4', 1)).toBeNull();
  });
});
