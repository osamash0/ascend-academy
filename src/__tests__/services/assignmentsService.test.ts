/**
 * Tests for assignmentsService.ts
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
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listEnrollableStudents,
} from '@/services/assignmentsService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

const ASSIGNMENT = {
  id: 'a1',
  professor_id: 'p1',
  course_id: null,
  title: 'Week 1 HW',
  description: null,
  due_at: '2026-12-01T00:00:00Z',
  min_quiz_score: null,
  created_at: null,
  lecture_ids: ['l1'],
};

// ─── listAssignments ──────────────────────────────────────────────────────────

describe('listAssignments', () => {
  it('returns assignments array from envelope', async () => {
    server.use(
      http.get(`${API}/assignments`, () =>
        HttpResponse.json({ success: true, data: [ASSIGNMENT] }),
      ),
    );
    const result = await listAssignments();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Week 1 HW');
  });

  it('returns empty array when no assignments', async () => {
    // default handler already returns []
    const result = await listAssignments();
    expect(result).toEqual([]);
  });

  it('throws on 500', async () => {
    server.use(
      http.get(`${API}/assignments`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(listAssignments()).rejects.toThrow();
  });
});

// ─── getAssignment ────────────────────────────────────────────────────────────

describe('getAssignment', () => {
  it('returns a single assignment by id', async () => {
    server.use(
      http.get(`${API}/assignments/a1`, () =>
        HttpResponse.json({ success: true, data: ASSIGNMENT }),
      ),
    );
    const result = await getAssignment('a1');
    expect(result.id).toBe('a1');
    expect(result.title).toBe('Week 1 HW');
  });

  it('throws on 404', async () => {
    server.use(
      http.get(`${API}/assignments/missing`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(getAssignment('missing')).rejects.toThrow();
  });
});

// ─── createAssignment ─────────────────────────────────────────────────────────

describe('createAssignment', () => {
  it('posts payload and returns new assignment', async () => {
    server.use(
      http.post(`${API}/assignments`, () =>
        HttpResponse.json({ success: true, data: ASSIGNMENT }),
      ),
    );
    const result = await createAssignment({
      title: 'Week 1 HW',
      lecture_ids: ['l1'],
      due_at: '2026-12-01T00:00:00Z',
    });
    expect(result.id).toBe('a1');
  });

  it('throws on 422 (missing required field)', async () => {
    server.use(
      http.post(`${API}/assignments`, () =>
        new HttpResponse('Unprocessable', { status: 422 }),
      ),
    );
    await expect(
      createAssignment({ title: '', lecture_ids: [], due_at: '' }),
    ).rejects.toThrow();
  });
});

// ─── updateAssignment ─────────────────────────────────────────────────────────

describe('updateAssignment', () => {
  it('patches and returns updated assignment', async () => {
    server.use(
      http.patch(`${API}/assignments/a1`, () =>
        HttpResponse.json({
          success: true,
          data: { ...ASSIGNMENT, title: 'Updated HW' },
        }),
      ),
    );
    const result = await updateAssignment('a1', { title: 'Updated HW' });
    expect(result.title).toBe('Updated HW');
  });

  it('throws on 404 when assignment does not exist', async () => {
    server.use(
      http.patch(`${API}/assignments/ghost`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(updateAssignment('ghost', { title: 'X' })).rejects.toThrow();
  });
});

// ─── deleteAssignment ─────────────────────────────────────────────────────────

describe('deleteAssignment', () => {
  it('resolves without throwing on successful delete', async () => {
    server.use(
      http.delete(`${API}/assignments/a1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(deleteAssignment('a1')).resolves.not.toThrow();
  });

  it('throws on 404', async () => {
    server.use(
      http.delete(`${API}/assignments/ghost`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(deleteAssignment('ghost')).rejects.toThrow();
  });
});

// ─── listEnrollableStudents ───────────────────────────────────────────────────

describe('listEnrollableStudents', () => {
  it('returns student list', async () => {
    server.use(
      http.get(`${API}/assignments/_meta/students`, () =>
        HttpResponse.json({
          success: true,
          data: [{ id: 's1', full_name: 'Alice' }],
        }),
      ),
    );
    const result = await listEnrollableStudents();
    expect(result).toHaveLength(1);
    expect(result[0].full_name).toBe('Alice');
  });

  it('returns empty array (does not throw) on error', async () => {
    server.use(
      http.get(`${API}/assignments/_meta/students`, () =>
        new HttpResponse('forbidden', { status: 403 }),
      ),
    );
    // listEnrollableStudents catches errors and returns []
    const result = await listEnrollableStudents();
    expect(result).toEqual([]);
  });
});
