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
  async fetchUsers(): Promise<AdminUser[]> {
    const res = await apiClient.get<{ success: boolean; data: AdminUser[] }>('/api/admin/users');
    return res.data;
  },

  /** Fetch user learning and login interaction events */
  async fetchEvents(page = 1, limit = 50): Promise<ActivityEvent[]> {
    const res = await apiClient.get<{ success: boolean; data: ActivityEvent[] }>(
      `/api/admin/events?page=${page}&limit=${limit}`
    );
    return res.data;
  },

  /** Fetch active error tickets from Sentry (falls back to mock if unconfigured) */
  async fetchErrors(): Promise<SentryErrorsResponse> {
    return apiClient.get<SentryErrorsResponse>('/api/admin/errors');
  },

  /** Toggle whether a course is archived (hidden from student catalog) */
  async toggleCourseVisibility(courseId: string): Promise<{ course_id: string; is_archived: boolean }> {
    const res = await apiClient.post<{ success: boolean; data: { course_id: string; is_archived: boolean } }>(
      `/api/admin/courses/${courseId}/toggle-visibility`,
      {}
    );
    return res.data;
  },

  /** Toggle whether a lecture is archived (hidden from students) */
  async toggleLectureVisibility(lectureId: string): Promise<{ lecture_id: string; is_archived: boolean }> {
    const res = await apiClient.post<{ success: boolean; data: { lecture_id: string; is_archived: boolean } }>(
      `/api/admin/lectures/${lectureId}/toggle-visibility`,
      {}
    );
    return res.data;
  },

  /** Reset all analytic data, writing a snapshot backup to the database first */
  async resetAnalytics(): Promise<{ message: string; backup_id: string }> {
    return apiClient.post<{ success: boolean; message: string; backup_id: string }>(
      '/api/admin/reset-analytics',
      { confirmation: 'RESET_ALL_DATA' }
    );
  },

  /** List all active database backups */
  async fetchBackups(): Promise<BackupSession[]> {
    const res = await apiClient.get<{ success: boolean; data: BackupSession[] }>('/api/admin/backups');
    return res.data;
  },

  /** Restore a database snapshot backup */
  async restoreBackup(backupId: string): Promise<{ message: string }> {
    return apiClient.post<{ success: boolean; message: string }>(
      `/api/admin/backups/${backupId}/restore`,
      { confirmation: 'RESTORE_DATA' }
    );
  },

  /** Delete a database backup permanently */
  async deleteBackup(backupId: string): Promise<{ message: string }> {
    return apiClient.delete<{ success: boolean; message: string }>(
      `/api/admin/backups/${backupId}`
    );
  },

  /** Fetch server runtime telemetry, connection count, and configuration variables */
  async fetchDeploymentInfo(): Promise<DeploymentTelemetry> {
    const res = await apiClient.get<{ success: boolean; data: DeploymentTelemetry }>('/api/admin/deployment-info');
    return res.data;
  }
};
