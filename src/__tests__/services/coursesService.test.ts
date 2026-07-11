/**
 * Tests for coursesService.ts
 * All calls go through apiClient → MSW intercepts them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  enrollInCourse,
  browseCourses,
  assignLectureToCourse,
  unassignLectureFromCourse,
  fetchCourseContext,
  updateCourseContext,
} from '@/services/coursesService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

const COURSE = {
  id: 'c1',
  professor_id: 'p1',
  title: 'Intro to ML',
  description: null,
  color: null,
  icon: null,
  is_archived: false,
  created_at: null,
  updated_at: null,
  lecture_count: 0,
};

// ─── listCourses ──────────────────────────────────────────────────────────────

describe('listCourses', () => {
  it('returns course list from envelope', async () => {
    server.use(
      http.get(`${API}/courses`, () =>
        HttpResponse.json({ success: true, data: [COURSE] }),
      ),
    );
    const result = await listCourses();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Intro to ML');
  });

  it('returns empty array when no courses', async () => {
    // default handler returns []
    const result = await listCourses();
    expect(result).toEqual([]);
  });

  it('appends only_archived query param when requested', async () => {
    let receivedUrl = '';
    server.use(
      http.get(`${API}/courses`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    await listCourses({ onlyArchived: true });
    expect(receivedUrl).toContain('only_archived=true');
  });

  it('appends include_archived query param when requested', async () => {
    let receivedUrl = '';
    server.use(
      http.get(`${API}/courses`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    await listCourses({ includeArchived: true });
    expect(receivedUrl).toContain('include_archived=true');
  });
});

// ─── getCourse ────────────────────────────────────────────────────────────────

describe('getCourse', () => {
  it('returns course with lectures when given a UUID', async () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    server.use(
      http.get(`${API}/courses/${uuid}`, () =>
        HttpResponse.json({
          success: true,
          data: { ...COURSE, id: uuid, lectures: [] },
        }),
      ),
    );
    const result = await getCourse(uuid);
    expect(result.id).toBe(uuid);
    expect(Array.isArray(result.lectures)).toBe(true);
  });

  it('throws when slug cannot be resolved to a course', async () => {
    // listCourses returns [] and browseCourses returns [] — slug lookup fails
    server.use(
      http.get(`${API}/courses`, () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
      http.get(`${API}/courses/browse`, () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
    );
    await expect(getCourse('nonexistent-slug')).rejects.toThrow(
      /Course not found for slug/,
    );
  });
});

// ─── createCourse ─────────────────────────────────────────────────────────────

describe('createCourse', () => {
  it('posts payload and returns new course', async () => {
    server.use(
      http.post(`${API}/courses`, () =>
        HttpResponse.json({ success: true, data: COURSE }),
      ),
    );
    const result = await createCourse({ title: 'Intro to ML' });
    expect(result.id).toBe('c1');
  });

  it('throws on 422', async () => {
    server.use(
      http.post(`${API}/courses`, () =>
        new HttpResponse('Unprocessable', { status: 422 }),
      ),
    );
    await expect(createCourse({ title: '' })).rejects.toThrow();
  });
});

// ─── updateCourse ─────────────────────────────────────────────────────────────

describe('updateCourse', () => {
  it('patches and returns updated course', async () => {
    server.use(
      http.patch(`${API}/courses/c1`, () =>
        HttpResponse.json({
          success: true,
          data: { ...COURSE, is_archived: true },
        }),
      ),
    );
    const result = await updateCourse('c1', { is_archived: true });
    expect(result.is_archived).toBe(true);
  });
});

// ─── deleteCourse ─────────────────────────────────────────────────────────────

describe('deleteCourse', () => {
  it('resolves without throwing on 204', async () => {
    server.use(
      http.delete(`${API}/courses/c1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(deleteCourse('c1')).resolves.not.toThrow();
  });

  it('appends reassign_to query param when provided', async () => {
    let receivedUrl = '';
    server.use(
      http.delete(`${API}/courses/c1`, ({ request }) => {
        receivedUrl = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteCourse('c1', 'c2');
    expect(receivedUrl).toContain('reassign_to=c2');
  });
});

// ─── enrollInCourse ───────────────────────────────────────────────────────────

describe('enrollInCourse', () => {
  it('resolves without throwing on success', async () => {
    // default handler already handles /courses/:id/enroll
    await expect(enrollInCourse('c1')).resolves.not.toThrow();
  });

  it('throws on 409 (already enrolled)', async () => {
    server.use(
      http.post(`${API}/courses/c1/enroll`, () =>
        new HttpResponse('Conflict', { status: 409 }),
      ),
    );
    await expect(enrollInCourse('c1')).rejects.toThrow();
  });
});

// ─── browseCourses ────────────────────────────────────────────────────────────

describe('browseCourses', () => {
  it('returns empty array by default', async () => {
    const result = await browseCourses();
    expect(result).toEqual([]);
  });

  it('returns browsable courses', async () => {
    server.use(
      http.get(`${API}/courses/browse`, () =>
        HttpResponse.json({ success: true, data: [COURSE] }),
      ),
    );
    const result = await browseCourses();
    expect(result).toHaveLength(1);
  });
});

// ─── assignLectureToCourse / unassignLectureFromCourse ────────────────────────

describe('assignLectureToCourse', () => {
  it('resolves without throwing', async () => {
    server.use(
      http.post(`${API}/courses/c1/lectures/l1`, () =>
        HttpResponse.json({ success: true, data: {} }),
      ),
    );
    await expect(assignLectureToCourse('c1', 'l1')).resolves.not.toThrow();
  });
});

describe('unassignLectureFromCourse', () => {
  it('resolves without throwing on 204', async () => {
    server.use(
      http.delete(`${API}/courses/c1/lectures/l1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(unassignLectureFromCourse('c1', 'l1')).resolves.not.toThrow();
  });
});

describe('fetchCourseContext', () => {
  it('returns null when no facts have been extracted yet', async () => {
    server.use(
      http.get(`${API}/courses/c1/context`, () =>
        HttpResponse.json({ success: true, data: null }),
      ),
    );
    expect(await fetchCourseContext('c1')).toBeNull();
  });

  it('returns extracted facts', async () => {
    server.use(
      http.get(`${API}/courses/c1/context`, () =>
        HttpResponse.json({
          success: true,
          data: {
            course_id: 'c1', instructor: 'Prof. Ada',
            exam_dates: [{ label: 'Midterm', date: '2026-06-01' }],
            syllabus_facts: {}, grading_scheme: '50/50', updated_at: null,
          },
        }),
      ),
    );
    const result = await fetchCourseContext('c1');
    expect(result?.instructor).toBe('Prof. Ada');
    expect(result?.exam_dates).toEqual([{ label: 'Midterm', date: '2026-06-01' }]);
  });
});

describe('updateCourseContext', () => {
  it('patches and returns the updated context', async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(`${API}/courses/c1/context`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            course_id: 'c1', instructor: 'Dr. Grace', exam_dates: [],
            syllabus_facts: {}, grading_scheme: null, updated_at: null,
          },
        });
      }),
    );
    const result = await updateCourseContext('c1', { instructor: 'Dr. Grace' });
    expect(result.instructor).toBe('Dr. Grace');
    expect(receivedBody).toEqual({ instructor: 'Dr. Grace' });
  });
});
