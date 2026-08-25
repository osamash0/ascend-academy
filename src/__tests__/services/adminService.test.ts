/**
 * Tests for adminService.ts
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

import { adminService } from '@/services/adminService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

const USER = {
  user_id: 'u1',
  email: 'user1@example.com',
  full_name: 'User One',
  display_name: 'User1',
  avatar_url: null,
  total_xp: 100,
  current_level: 2,
  created_at: null,
  last_seen: null,
  roles: ['student'],
};

describe('fetchUsers', () => {
  it('returns the paginated envelope with default paging params', async () => {
    server.use(
      http.get(`${API}/admin/users`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('1');
        expect(url.searchParams.get('limit')).toBe('50');
        expect(url.searchParams.has('search')).toBe(false);
        return HttpResponse.json({
          success: true,
          data: [USER],
          meta: { total: 1, page: 1, limit: 50, total_pages: 1 },
        });
      }),
    );
    const result = await adminService.fetchUsers();
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('includes search and role params when given', async () => {
    server.use(
      http.get(`${API}/admin/users`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('search')).toBe('alice');
        expect(url.searchParams.get('role')).toBe('professor');
        return HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 50, total_pages: 0 } });
      }),
    );
    await adminService.fetchUsers(1, 50, 'alice', 'professor');
  });

  it('throws on 403 (non-admin caller)', async () => {
    server.use(
      http.get(`${API}/admin/users`, () => new HttpResponse('Forbidden', { status: 403 })),
    );
    await expect(adminService.fetchUsers()).rejects.toThrow();
  });
});

describe('updateUserRole', () => {
  it('posts the action/role and returns updated roles', async () => {
    server.use(
      http.post(`${API}/admin/users/u1/roles`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ action: 'add', role: 'professor' });
        return HttpResponse.json({ success: true, data: { user_id: 'u1', roles: ['student', 'professor'] } });
      }),
    );
    const result = await adminService.updateUserRole('u1', 'professor', 'add');
    expect(result.roles).toContain('professor');
  });

  it('throws on 400 for an invalid role', async () => {
    server.use(
      http.post(`${API}/admin/users/u1/roles`, () => new HttpResponse('Bad Request', { status: 400 })),
    );
    await expect(adminService.updateUserRole('u1', 'bogus', 'add')).rejects.toThrow();
  });
});

describe('fetchUserDetail', () => {
  it('returns the user detail envelope', async () => {
    server.use(
      http.get(`${API}/admin/users/u1/detail`, () =>
        HttpResponse.json({
          success: true,
          data: { profile: USER, recent_events: [], monthly_spend_usd: 0.5 },
        }),
      ),
    );
    const result = await adminService.fetchUserDetail('u1');
    expect(result.profile.user_id).toBe('u1');
    expect(result.monthly_spend_usd).toBe(0.5);
  });

  it('throws on 404 for an unknown user', async () => {
    server.use(
      http.get(`${API}/admin/users/ghost/detail`, () => new HttpResponse('Not Found', { status: 404 })),
    );
    await expect(adminService.fetchUserDetail('ghost')).rejects.toThrow();
  });
});

describe('fetchPlatformStats', () => {
  it('returns platform stats', async () => {
    server.use(
      http.get(`${API}/admin/platform-stats`, () =>
        HttpResponse.json({
          success: true,
          data: {
            users: { total: 10, professors: 1, admins: 1, students: 8, active_24h: 3 },
            content: { courses: 5, lectures: 20 },
            financial: { month_llm_cost_usd: 1.23 },
          },
        }),
      ),
    );
    const result = await adminService.fetchPlatformStats();
    expect(result.users.total).toBe(10);
  });
});

describe('fetchEvents', () => {
  it('returns the paginated events envelope', async () => {
    server.use(
      http.get(`${API}/admin/events`, () =>
        HttpResponse.json({
          success: true,
          data: [{ id: 'e1', user_id: 'u1', event_type: 'slide_view', event_data: {}, created_at: '2026-01-01', user_email: 'a@b.com', user_name: 'A' }],
          meta: { total: 1, page: 1, limit: 50, total_pages: 1 },
        }),
      ),
    );
    const result = await adminService.fetchEvents();
    expect(result.data[0].event_type).toBe('slide_view');
  });
});

describe('fetchErrors', () => {
  it('returns an unconfigured Sentry response as-is', async () => {
    server.use(
      http.get(`${API}/admin/errors`, () =>
        HttpResponse.json({ success: true, configured: false, data: [] }),
      ),
    );
    const result = await adminService.fetchErrors();
    expect(result.configured).toBe(false);
  });
});

describe('toggleCourseVisibility', () => {
  it('returns the new archived state', async () => {
    server.use(
      http.post(`${API}/admin/courses/c1/toggle-visibility`, () =>
        HttpResponse.json({ success: true, data: { course_id: 'c1', is_archived: true } }),
      ),
    );
    const result = await adminService.toggleCourseVisibility('c1');
    expect(result.is_archived).toBe(true);
  });
});

describe('toggleLectureVisibility', () => {
  it('returns the new archived state', async () => {
    server.use(
      http.post(`${API}/admin/lectures/l1/toggle-visibility`, () =>
        HttpResponse.json({ success: true, data: { lecture_id: 'l1', is_archived: false } }),
      ),
    );
    const result = await adminService.toggleLectureVisibility('l1');
    expect(result.is_archived).toBe(false);
  });
});

describe('resetAnalytics', () => {
  it('posts the required confirmation string and returns a backup id', async () => {
    server.use(
      http.post(`${API}/admin/reset-analytics`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ confirmation: 'RESET_ALL_DATA' });
        return HttpResponse.json({ success: true, message: 'ok', backup_id: 'bk1' });
      }),
    );
    const result = await adminService.resetAnalytics();
    expect(result.backup_id).toBe('bk1');
  });
});

describe('fetchBackups / restoreBackup / deleteBackup', () => {
  it('lists backups', async () => {
    server.use(
      http.get(`${API}/admin/backups`, () =>
        HttpResponse.json({ success: true, data: [{ id: 'bk1', created_at: '2026-01-01', size_bytes: 1024 }] }),
      ),
    );
    const result = await adminService.fetchBackups();
    expect(result).toHaveLength(1);
  });

  it('restores a backup with the required confirmation string', async () => {
    server.use(
      http.post(`${API}/admin/backups/bk1/restore`, async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ confirmation: 'RESTORE_DATA' });
        return HttpResponse.json({ success: true, message: 'restored' });
      }),
    );
    const result = await adminService.restoreBackup('bk1');
    expect(result.message).toBe('restored');
  });

  it('deletes a backup', async () => {
    server.use(
      http.delete(`${API}/admin/backups/bk1`, () =>
        HttpResponse.json({ success: true, message: 'deleted' }),
      ),
    );
    const result = await adminService.deleteBackup('bk1');
    expect(result.message).toBe('deleted');
  });

  it('throws on 404 when restoring a missing backup', async () => {
    server.use(
      http.post(`${API}/admin/backups/ghost/restore`, () => new HttpResponse('Not Found', { status: 404 })),
    );
    await expect(adminService.restoreBackup('ghost')).rejects.toThrow();
  });
});

describe('fetchDeploymentInfo', () => {
  it('returns deployment telemetry', async () => {
    server.use(
      http.get(`${API}/admin/deployment-info`, () =>
        HttpResponse.json({
          success: true,
          data: {
            health: { database: 'healthy', database_connections: 5, ai_services: 'connected', sentry: 'active', sentry_dsn: '', api: 'healthy' },
            system: { os: 'Linux', release: '', python_version: '3.11' },
            deployments: { migrations_count: 10, app_version: '3.0.0' },
            environment: {},
          },
        }),
      ),
    );
    const result = await adminService.fetchDeploymentInfo();
    expect(result.health.api).toBe('healthy');
    expect(result.deployments.app_version).toBe('3.0.0');
  });
});
