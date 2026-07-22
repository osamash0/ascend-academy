import { apiClient } from '@/lib/apiClient';

export interface AdminUser {
  user_id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  total_xp: number;
  current_level: number;
  created_at: string | null;
  last_seen: string | null;
  roles: string[];
}

export interface ActivityEvent {
  id: string;
  user_id: string;
  event_type: string;
  event_data: any;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface UserDetail {
  profile: AdminUser;
  recent_events: ActivityEvent[];
  monthly_spend_usd: number;
}

export interface PlatformStats {
  users: {
    total: number;
    professors: number;
    admins: number;
    students: number;
    active_24h: number;
  };
  content: {
    courses: number;
    lectures: number;
  };
  financial: {
    month_llm_cost_usd: number;
  };
}

export interface SentryError {
  id: string;
  title: string;
  culprit: string;
  count: number;
  userCount: number;
  lastSeen: string;
  status: string;
  permalink: string;
  level: string;
  project: string;
}

export interface SentryErrorsResponse {
  success: boolean;
  configured: boolean;
  config_help?: {
    message: string;
    org: string | null;
    project: string | null;
    has_token: boolean;
  };
  data: SentryError[];
}

export interface BackupSession {
  id: string;
  created_at: string;
  size_bytes: number;
}

export interface DeploymentTelemetry {
  health: {
    database: string;
    database_connections: number;
    ai_services: string;
    sentry: string;
    sentry_dsn: string;
  };
  system: {
    os: string;
    release: string;
    python_version: string;
  };
  deployments: {
    migrations_count: number;
    app_version: string;
  };
  environment: Record<string, string | boolean>;
}

export const adminService = {
  /** Fetch all platform users with roles and simple statistics */
  async fetchUsers(
    page = 1,
    limit = 50,
    search?: string,
    role?: string,
    sortBy = 'created_at',
    sortDesc = true
  ): Promise<PaginatedResponse<AdminUser>> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sort_by: sortBy,
      sort_desc: sortDesc.toString(),
    });
    if (search) params.append('search', search);
    if (role) params.append('role', role);

    const res = await apiClient.get<PaginatedResponse<AdminUser>>(`/api/v1/admin/users?${params.toString()}`);
    return res as unknown as PaginatedResponse<AdminUser>;
  },

  /** Manage user roles */
  async updateUserRole(userId: string, role: string, action: 'add' | 'remove'): Promise<{ user_id: string; roles: string[] }> {
    const res = await apiClient.post<{ success: boolean; data: { user_id: string; roles: string[] } }>(
      `/api/v1/admin/users/${userId}/roles`,
      { action, role }
    );
    return res.data;
  },

  /** Fetch user detail */
  async fetchUserDetail(userId: string): Promise<UserDetail> {
    const res = await apiClient.get<{ success: boolean; data: UserDetail }>(`/api/v1/admin/users/${userId}/detail`);
    return res.data;
  },

  /** Fetch platform stats */
  async fetchPlatformStats(): Promise<PlatformStats> {
    const res = await apiClient.get<{ success: boolean; data: PlatformStats }>('/api/v1/admin/platform-stats');
    return res.data;
  },

  /** Fetch user learning and login interaction events */
  async fetchEvents(
    page = 1,
    limit = 50,
    eventType?: string,
    dateFrom?: string,
    dateTo?: string,
    search?: string
  ): Promise<PaginatedResponse<ActivityEvent>> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (eventType) params.append('event_type', eventType);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    if (search) params.append('search', search);

    const res = await apiClient.get<PaginatedResponse<ActivityEvent>>(`/api/v1/admin/events?${params.toString()}`);
    return res as unknown as PaginatedResponse<ActivityEvent>;
  },

  /** Fetch active error tickets from Sentry (falls back to mock if unconfigured) */
  async fetchErrors(): Promise<SentryErrorsResponse> {
    return apiClient.get<SentryErrorsResponse>('/api/v1/admin/errors');
  },

  /** Toggle whether a course is archived (hidden from student catalog) */
  async toggleCourseVisibility(courseId: string): Promise<{ course_id: string; is_archived: boolean }> {
    const res = await apiClient.post<{ success: boolean; data: { course_id: string; is_archived: boolean } }>(
      `/api/v1/admin/courses/${courseId}/toggle-visibility`,
      {}
    );
    return res.data;
  },

  /** Toggle whether a lecture is archived (hidden from students) */
  async toggleLectureVisibility(lectureId: string): Promise<{ lecture_id: string; is_archived: boolean }> {
    const res = await apiClient.post<{ success: boolean; data: { lecture_id: string; is_archived: boolean } }>(
      `/api/v1/admin/lectures/${lectureId}/toggle-visibility`,
      {}
    );
    return res.data;
  },

  /** Reset all analytic data, writing a snapshot backup to the database first */
  async resetAnalytics(): Promise<{ message: string; backup_id: string }> {
    return apiClient.post<{ success: boolean; message: string; backup_id: string }>(
      '/api/v1/admin/reset-analytics',
      { confirmation: 'RESET_ALL_DATA' }
    );
  },

  /** List all active database backups */
  async fetchBackups(): Promise<BackupSession[]> {
    const res = await apiClient.get<{ success: boolean; data: BackupSession[] }>('/api/v1/admin/backups');
    return res.data;
  },

  /** Restore a database snapshot backup */
  async restoreBackup(backupId: string): Promise<{ message: string }> {
    return apiClient.post<{ success: boolean; message: string }>(
      `/api/v1/admin/backups/${backupId}/restore`,
      { confirmation: 'RESTORE_DATA' }
    );
  },

  /** Delete a database backup permanently */
  async deleteBackup(backupId: string): Promise<{ message: string }> {
    return apiClient.delete<{ success: boolean; message: string }>(
      `/api/v1/admin/backups/${backupId}`
    );
  },

  /** Fetch server runtime telemetry, connection count, and configuration variables */
  async fetchDeploymentInfo(): Promise<DeploymentTelemetry> {
    const res = await apiClient.get<{ success: boolean; data: DeploymentTelemetry }>('/api/v1/admin/deployment-info');
    return res.data;
  }
};
