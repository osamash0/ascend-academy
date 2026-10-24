import { afterEach, describe, expect, it } from 'vitest';
import { search } from '../data/search';
import * as fixtures from '../mocks/search';
import { setLiveWorld } from '../data/world';
import type { Lesson, Space } from '../types';
import { emptyWorld } from './emptyWorld';

const space = (id: string, name: string, over: Partial<Space> = {}) =>
  ({ id, name, viewerRole: 'member', visibility: 'public', state: 'active', ...over }) as Space;
const lesson = (spaceId: string, order: number, title: string, over: Partial<Lesson> = {}) =>
  ({ id: `${spaceId}-${order}`, spaceId, order, title, state: 'published', concepts: [], ...over }) as Lesson;

afterEach(() => setLiveWorld(null));

describe('⌘K, live', () => {
  it('demo is the fixture search', () => {
    expect(search('data')).toEqual(fixtures.search('data'));
  });

  it('finds Spaces, published Lessons and ideas — each naming its Space', () => {
    setLiveWorld(emptyWorld({
      spaces: [space('dbs', 'Datenbanksysteme'), space('secret', 'Datenbank-Geheimkurs', { viewerRole: null, visibility: 'private' })],
      lessons: [
        lesson('dbs', 1, 'Relationale Algebra', {
          concepts: [{ id: 'k1', name: 'Natural join', progress: 'untouched' }],
        }),
        lesson('dbs', 2, 'Joins in SQL', {
          concepts: [{ id: 'k2', name: 'Natural join', progress: 'untouched' }],
        }),
        lesson('dbs', 3, 'Join draft', { state: 'draft' }),
      ],
    }));
    const r = search('join');
    expect(r.lessons.map((h) => [h.title, h.spaceName])).toEqual([['Joins in SQL', 'Datenbanksysteme']]);
    // One hit per idea, opening the first Lesson that teaches it.
    expect(r.concepts).toEqual([
      { id: 'k1', title: 'Natural join', spaceName: 'Datenbanksysteme', href: '/v4/space/dbs/lesson/dbs-1' },
    ]);
    expect(search('datenbank').spaces.map((h) => h.title)).toEqual(['Datenbanksysteme']); // private stays out
    expect(search('   ')).toEqual({ spaces: [], lessons: [], concepts: [], contributions: [] });
  });
});
