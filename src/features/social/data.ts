/**
 * Social Gamification types + small client-side helpers.
 *
 * All real data comes from Supabase (see api.ts / hooks.ts). This file only
 * holds shared types and pure presentational helpers (avatar gradients,
 * initials). The friends graph, profiles, and XP are live.
 */

export type Role = "Student" | "Self-learner" | "Tutor" | "Researcher" | "Professor";

export type RelationshipStatus = "none" | "pending_outgoing" | "incoming" | "friends";

export const SOCIAL_ROLE_OPTIONS: Role[] = [
  "Student",
  "Self-learner",
  "Tutor",
  "Researcher",
  "Professor",
];

/** Normalised social user used across the UI (mapped from RPC rows). */
export interface SocialUser {
  id: string; // auth user_id
  name: string;
  initials: string;
  avatarUrl?: string | null;
  roles: Role[];
  institution: string | null;
  totalXp: number;
  weeklyXp: number;
  level: number;
  streak: number;
  /** active today (real presence proxy from last_active_date) */
  online: boolean;
  relationship?: RelationshipStatus;
  mutualFriends?: number;
  mutualCourses?: number;
  isCurrentUser?: boolean;
}

export interface FriendRequestItem extends SocialUser {
  direction: "incoming" | "outgoing";
  createdAt: string;
}

export interface CourseChip {
  courseId: string;
  title: string;
  mutual: boolean;
}

/* ------------------------------ helpers ----------------------------------- */

export const initialsOf = (name: string | null | undefined): string =>
  (name ?? "")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

/** Deterministic gradient (from → to) per id, for initial-avatars. */
const GRADIENTS: [string, string][] = [
  ["#5E6BFF", "#8B5CF6"],
  ["#22D3EE", "#5E6BFF"],
  ["#A78BFA", "#8B5CF6"],
  ["#FB923C", "#FCD34D"],
  ["#34D399", "#22D3EE"],
  ["#F472B6", "#8B5CF6"],
];

export const avatarGradient = (id: string): [string, string] => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
};
