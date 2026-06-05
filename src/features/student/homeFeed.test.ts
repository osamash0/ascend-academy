import { describe, expect, it } from 'vitest';
import {
  indexProgress,
  selectHero,
  buildWidgets,
  buildRows,
  toLectureView,
} from './homeFeed';
import type { Lecture, StudentProgress, Achievement, Profile } from '@/types/domain';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function lecture(over: Partial<Lecture> & { id: string }): Lecture {
  return {
    title: over.title ?? over.id,
    description: null,
    total_slides: 10,
    created_at: '2026-01-01T00:00:00Z',
    course_id: null,
    course: null,
    ...over,
  };
}

function progress(over: Partial<StudentProgress> & { lecture_id: string }): StudentProgress {
  return {
    completed_slides: [],
    quiz_score: 0,
    total_questions_answered: 0,
    correct_answers: 0,
    ...over,
  };
}

const slides = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

// ─── toLectureView ───────────────────────────────────────────────────────────

describe('toLectureView', () => {
  it('derives percent, status and accuracy', () => {
    const v = toLectureView(
      lecture({ id: 'l1', title: '3 - Indexing', total_slides: 10 }),
      progress({ lecture_id: 'l1', completed_slides: slides(5), total_questions_answered: 4, correct_answers: 3 }),
    );
    expect(v.pct).toBe(50);
    expect(v.status).toBe('progress');
    expect(v.accuracy).toBe(75);
    expect(v.badge).toBe('3');
    expect(v.cleanTitle).toBe('Indexing');
    expect(v.order).toBe(3);
  });

  it('marks 100% complete as done and no progress as new', () => {
    expect(toLectureView(lecture({ id: 'a', total_slides: 4 }), progress({ lecture_id: 'a', completed_slides: slides(4) })).status).toBe('done');
    expect(toLectureView(lecture({ id: 'b' })).status).toBe('new');
  });

  it('handles zero-slide lectures without dividing by zero', () => {
    const v = toLectureView(lecture({ id: 'z', total_slides: 0 }));
    expect(v.pct).toBe(0);
    expect(v.status).toBe('new');
  });
});

// ─── selectHero ────────────────────────────────────────────────────────────────

describe('selectHero', () => {
  it('returns null when there are no lectures', () => {
    expect(selectHero([], indexProgress([]))).toBeNull();
  });

  it('prefers resume: most recently active in-progress lecture', () => {
    const lectures = [lecture({ id: 'a' }), lecture({ id: 'b' })];
    const prog = [
      progress({ lecture_id: 'a', completed_slides: slides(3), last_slide_viewed: 3, updated_at: '2026-06-01T00:00:00Z' }),
      progress({ lecture_id: 'b', completed_slides: slides(5), last_slide_viewed: 5, updated_at: '2026-06-03T00:00:00Z' }),
    ];
    const hero = selectHero(lectures, indexProgress(prog));
    expect(hero?.kind).toBe('resume');
    expect(hero?.view.lecture.id).toBe('b'); // more recent
    expect(hero?.resumeSlide).toBe(5);
    expect(hero?.ctaLabel).toBe('Continue');
  });

  it('falls back to next-up when nothing is in progress, favouring the furthest course', () => {
    const lectures = [
      lecture({ id: 'c1l1', title: '1 - Intro', course_id: 'c1' }),
      lecture({ id: 'c1l2', title: '2 - Deep', course_id: 'c1' }),
      lecture({ id: 'c2l1', title: '1 - Other', course_id: 'c2' }),
    ];
    // Course c1 has one completed lecture, c2 has none → recommend next in c1.
    const prog = [progress({ lecture_id: 'c1l1', completed_slides: slides(10) })];
    const hero = selectHero(lectures, indexProgress(prog));
    expect(hero?.kind).toBe('next');
    expect(hero?.view.lecture.id).toBe('c1l2');
    expect(hero?.ctaLabel).toBe('Start');
  });

  it('returns review (weakest completed) when everything is done', () => {
    const lectures = [lecture({ id: 'a', total_slides: 4 }), lecture({ id: 'b', total_slides: 4 })];
    const prog = [
      progress({ lecture_id: 'a', completed_slides: slides(4), total_questions_answered: 10, correct_answers: 9 }),
      progress({ lecture_id: 'b', completed_slides: slides(4), total_questions_answered: 10, correct_answers: 4 }),
    ];
    const hero = selectHero(lectures, indexProgress(prog));
    expect(hero?.kind).toBe('review');
    expect(hero?.view.lecture.id).toBe('b'); // lower accuracy
    expect(hero?.ctaLabel).toBe('Review');
  });

  it('onboards a brand-new student with the first lecture in sequence', () => {
    const lectures = [
      lecture({ id: 'l2', title: '2 - Second' }),
      lecture({ id: 'l1', title: '1 - First' }),
    ];
    const hero = selectHero(lectures, indexProgress([]));
    expect(hero?.kind).toBe('onboard');
    expect(hero?.view.lecture.id).toBe('l1');
    expect(hero?.ctaLabel).toBe('Begin');
  });
});

// ─── buildWidgets ───────────────────────────────────────────────────────────────

describe('buildWidgets', () => {
  const profile: Profile = {
    id: 'p', user_id: 'u', email: 'e', full_name: 'Ada', avatar_url: null,
    total_xp: 1200, current_level: 5, current_streak: 4, best_streak: 9,
  };

  it('always includes streak and trophies widgets', () => {
    const kinds = buildWidgets([], indexProgress([]), [], profile).map((w) => w.kind);
    expect(kinds).toContain('streak');
    expect(kinds).toContain('trophies');
  });

  it('includes an up-next widget only when an uncompleted lecture exists', () => {
    const done = buildWidgets(
      [lecture({ id: 'a', total_slides: 2 })],
      indexProgress([progress({ lecture_id: 'a', completed_slides: slides(2) })]),
      [], profile,
    );
    expect(done.find((w) => w.kind === 'upNext')).toBeUndefined();

    const open = buildWidgets([lecture({ id: 'b' })], indexProgress([]), [], profile);
    expect(open.find((w) => w.kind === 'upNext')).toBeDefined();
  });

  it('aggregates per-course progress and overall percent', () => {
    const lectures = [
      lecture({ id: 'a', course_id: 'c1', course: { id: 'c1', title: 'DB' }, total_slides: 2 }),
      lecture({ id: 'b', course_id: 'c1', course: { id: 'c1', title: 'DB' } }),
    ];
    const prog = [progress({ lecture_id: 'a', completed_slides: slides(2) })];
    const widgets = buildWidgets(lectures, indexProgress(prog), [], profile);
    const cp = widgets.find((w) => w.kind === 'courseProgress');
    expect(cp).toBeDefined();
    if (cp?.kind === 'courseProgress') {
      expect(cp.courses[0].title).toBe('DB');
      expect(cp.courses[0].completed).toBe(1);
      expect(cp.courses[0].total).toBe(2);
      expect(cp.overallPct).toBe(50);
    }
  });

  it('surfaces recent achievements in the trophies widget', () => {
    const achievements: Achievement[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, badge_name: `Badge ${i}`, badge_description: null, badge_icon: null,
      earned_at: '2026-05-01T00:00:00Z',
    }));
    const t = buildWidgets([], indexProgress([]), achievements, profile).find((w) => w.kind === 'trophies');
    if (t?.kind === 'trophies') {
      expect(t.total).toBe(5);
      expect(t.recent).toHaveLength(3);
    }
  });
});

// ─── buildRows ─────────────────────────────────────────────────────────────────

describe('buildRows', () => {
  it('puts Continue Learning first, recency-ordered, and one row per course', () => {
    const lectures = [
      lecture({ id: 'a', course_id: 'c1', course: { id: 'c1', title: 'DB' } }),
      lecture({ id: 'b', course_id: 'c1', course: { id: 'c1', title: 'DB' } }),
      lecture({ id: 'c', course_id: 'c2', course: { id: 'c2', title: 'OS' } }),
    ];
    const prog = [
      progress({ lecture_id: 'a', completed_slides: slides(3), updated_at: '2026-06-01T00:00:00Z' }),
      progress({ lecture_id: 'b', completed_slides: slides(3), updated_at: '2026-06-03T00:00:00Z' }),
    ];
    const rows = buildRows(lectures, indexProgress(prog));
    expect(rows[0].id).toBe('continue');
    expect(rows[0].items.map((v) => v.lecture.id)).toEqual(['b', 'a']); // recency desc
    expect(rows.some((r) => r.id === 'course:c1')).toBe(true);
    expect(rows.some((r) => r.id === 'course:c2')).toBe(true);
  });

  it('omits the Continue row when nothing is in progress', () => {
    const rows = buildRows([lecture({ id: 'a' })], indexProgress([]));
    expect(rows.find((r) => r.id === 'continue')).toBeUndefined();
  });

  it('excludes uncategorized lectures from course rows', () => {
    const lectures = [
      lecture({ id: 'a', course_id: 'c1', course: { id: 'c1', title: 'DB' } }),
      lecture({ id: 'u', course_id: null }),
    ];
    const rows = buildRows(lectures, indexProgress([]));
    expect(rows.some((r) => r.id === 'course:__uncat__')).toBe(false);
  });
});
