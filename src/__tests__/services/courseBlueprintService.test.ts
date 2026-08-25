/**
 * Tests for courseBlueprintService.ts
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
  fetchCourseBlueprint,
  updateCourseBlueprint,
  updateCourseBlueprintItem,
  splitCourseBlueprintItem,
  createCourseFromBlueprint,
} from '@/services/courseBlueprintService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

const BLUEPRINT = {
  id: 'bp1',
  batch_id: 'b1',
  course_id: null,
  title: 'Intro Course',
  description: null,
  study_goal: null,
  status: 'draft' as const,
  items: [],
};

describe('fetchCourseBlueprint', () => {
  it('returns the blueprint from the envelope', async () => {
    server.use(
      http.get(`${API}/onboarding/batches/b1/blueprint`, () =>
        HttpResponse.json({ success: true, data: BLUEPRINT }),
      ),
    );
    const result = await fetchCourseBlueprint('b1');
    expect(result.id).toBe('bp1');
    expect(result.title).toBe('Intro Course');
  });

  it('throws on 404 when the batch has no blueprint', async () => {
    server.use(
      http.get(`${API}/onboarding/batches/ghost/blueprint`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(fetchCourseBlueprint('ghost')).rejects.toThrow();
  });
});

describe('updateCourseBlueprint', () => {
  it('patches and returns the updated blueprint', async () => {
    server.use(
      http.patch(`${API}/onboarding/blueprints/bp1`, () =>
        HttpResponse.json({ success: true, data: { ...BLUEPRINT, title: 'Renamed' } }),
      ),
    );
    const result = await updateCourseBlueprint('bp1', { title: 'Renamed' });
    expect(result.title).toBe('Renamed');
  });

  it('throws on 422', async () => {
    server.use(
      http.patch(`${API}/onboarding/blueprints/bp1`, () =>
        new HttpResponse('Unprocessable', { status: 422 }),
      ),
    );
    await expect(updateCourseBlueprint('bp1', { title: '' })).rejects.toThrow();
  });
});

describe('updateCourseBlueprintItem', () => {
  it('patches an item and returns the updated blueprint', async () => {
    server.use(
      http.patch(`${API}/onboarding/blueprints/bp1/items/it1`, () =>
        HttpResponse.json({
          success: true,
          data: { ...BLUEPRINT, items: [{ id: 'it1', include_in_course: false }] },
        }),
      ),
    );
    const result = await updateCourseBlueprintItem('bp1', 'it1', { include_in_course: false });
    expect(result.items[0].include_in_course).toBe(false);
  });
});

describe('splitCourseBlueprintItem', () => {
  it('posts an after_slide split point and returns the updated blueprint', async () => {
    server.use(
      http.post(`${API}/onboarding/blueprints/bp1/items/it1/split`, () =>
        HttpResponse.json({ success: true, data: BLUEPRINT }),
      ),
    );
    const result = await splitCourseBlueprintItem('bp1', 'it1', 3);
    expect(result.id).toBe('bp1');
  });

  it('posts an empty body when no split point is given', async () => {
    server.use(
      http.post(`${API}/onboarding/blueprints/bp1/items/it1/split`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({});
        return HttpResponse.json({ success: true, data: BLUEPRINT });
      }),
    );
    await splitCourseBlueprintItem('bp1', 'it1');
  });
});

describe('createCourseFromBlueprint', () => {
  it('returns the created course', async () => {
    server.use(
      http.post(`${API}/onboarding/blueprints/bp1/create-course`, () =>
        HttpResponse.json({ success: true, data: { course: { id: 'c1', title: 'Intro Course' } } }),
      ),
    );
    const result = await createCourseFromBlueprint('bp1');
    expect(result.id).toBe('c1');
  });

  it('throws on 409 when the blueprint was already used', async () => {
    server.use(
      http.post(`${API}/onboarding/blueprints/bp1/create-course`, () =>
        new HttpResponse('Conflict', { status: 409 }),
      ),
    );
    await expect(createCourseFromBlueprint('bp1')).rejects.toThrow();
  });
});
