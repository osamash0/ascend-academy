import { apiClient } from '@/lib/apiClient';

/** Mirrors backend/services/launch_control_service.py. */

export type GateStatus = 'pass' | 'fail' | 'confirm';

export interface LaunchGate {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
}

export interface LaunchFunnel {
  signed_up: number;
  onboarded: number;
  activated: number;
  came_back: number;
  week_2_active: number;
}

export interface LaunchPulse {
  classification_ready: boolean;
  totals: {
    real_users: number;
    all_users: number;
    signups_7d: number;
    active_24h: number;
    active_7d: number;
  };
  funnel: LaunchFunnel | null;
  sources: { source: string; signed_up: number; activated: number }[];
  signups_daily: { date: string; signups: number }[];
  feed: { at: string; event_type: string; user_id: string; who: string | null }[];
}

export interface LaunchAiSpend {
  ceiling_usd: number;
  user_cap_usd: number;
  today_usd: number;
  month_usd: number;
  daily: { date: string; usd: number; calls: number }[];
  by_feature: { feature: string; usd: number; calls: number }[];
  by_provider: { provider: string; model: string; usd: number; calls: number }[];
  top_users: { user_id: string; who: string | null; usd: number; calls: number }[];
}

export interface CatalogLecture {
  id: string;
  course_id: string;
  course: string;
  title: string;
  slides: number;
  quizzes: number;
  concepts: number;
  poster: boolean;
  embedded: number;
  missing: string[];
}

export interface LaunchOverview {
  generated_at: string;
  gates: LaunchGate[];
  pulse: LaunchPulse;
  ai: LaunchAiSpend;
  catalog: CatalogLecture[];
  models: { mode: string; quality: string; bulk: string };
}

export const launchControlService = {
  fetchOverview(): Promise<LaunchOverview> {
    return apiClient.get<LaunchOverview>('/api/v1/admin/launch/overview');
  },

  /** true = internal (test/staff), false = real, null = back to the email rules. */
  setClassification(userId: string, isInternal: boolean | null, reason?: string) {
    return apiClient.post<{ user_id: string; is_internal: boolean; internal_reason: string | null }>(
      `/api/v1/admin/launch/users/${userId}/classification`,
      { is_internal: isInternal, reason },
    );
  },
};
