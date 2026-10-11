import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as store from '../shelf';
import { spaceById } from '../spaces';
import { locateLesson } from '../lessons';
import { STUDIO_CANVAS } from '../studio-canvas';

beforeEach(() => store.__reset());

describe('seed', () => {
  it('every opens and share resolves', () => {
    for (const i of store.getItems()) {
      if (i.opens.kind === 'canvas') expect(i.opens.canvasId).toBe(STUDIO_CANVAS.id);
      else {
        expect(locateLesson(i.opens.lessonId)?.spaceId).toBe(i.opens.spaceId);
      }
      if (i.share.kind !== 'private') expect(spaceById(i.share.spaceId)?.viewerRole).toBeTruthy();
    }
  });
  it('has the three named items first', () => {
    expect(store.getItems().slice(0, 3).map((i) => i.id)).toEqual(['m-norm', 'm-design-notes', 'm-axioms']);
    expect(store.getItems().length).toBeGreaterThan(3);
  });
});

describe('mutations', () => {
  it('bringIn develops, then settles', () => {
    const id = store.bringIn('New.pdf', '2026-10-11T10:00:00Z');
    expect(store.getItems()[0]).toMatchObject({ id, stage: 'developing', sample: true, pageCount: 12 });
    store.settleDeveloping(id, true);
    expect(store.getItems()[0].stage).toBe('ready');
    const id2 = store.bringIn('Bad.pdf');
    store.settleDeveloping(id2, false);
    expect(store.getItems()[0].stage).toBe('failed');
  });
  it('share follows role and mode', () => {
    const id = store.bringIn('S.pdf');
    store.share(id, 's-dbs', 'member', 'guided');
    expect(store.getItems()[0].share).toMatchObject({ kind: 'shared', as: 'contribution', likes: 0, endorsed: false, cleared: 0 });
    store.share(id, 's-linalg', 'owner', 'open');
    expect(store.getItems()[0].share).toMatchObject({ kind: 'draft', as: 'lesson' });
    store.publish(id);
    expect(store.getItems()[0].share.kind).toBe('shared');
    store.unshare(id);
    expect(store.getItems()[0].share.kind).toBe('private');
  });
  it('progress mutators', () => {
    store.markRead('m-design-notes', 2);
    store.bumpAnswers('m-norm', 1);
    store.setRecall('m-norm', 10, 31);
    store.touch('m-axioms', '2026-10-11T12:00:00Z');
    const by = (id: string) => store.getItems().find((i) => i.id === id)!;
    expect(by('m-norm').progress).toMatchObject({ answers: 3, recallKnew: 10 });
    expect(by('m-axioms').lastOpenedAt).toBe('2026-10-11T12:00:00Z');
    expect(by('m-design-notes').lastPage).toBe(2);
  });
  it('remove then restore keeps the index', () => {
    const before = store.getItems();
    const r = store.remove('m-design-notes')!;
    expect(r.index).toBe(1);
    expect(store.getItems().some((i) => i.id === 'm-design-notes')).toBe(false);
    store.restore(r);
    expect(store.getItems().map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(store.remove('nope')).toBeNull();
  });
  it('subscribe fires on every mutation', () => {
    const fn = vi.fn();
    const off = store.subscribe(fn);
    const id = store.bringIn('A.pdf');
    store.settleDeveloping(id, true);
    store.markRead(id, 1);
    store.share(id, 's-dbs', 'member', 'guided');
    store.remove(id);
    expect(fn).toHaveBeenCalledTimes(5);
    off();
    store.bringIn('B.pdf');
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
