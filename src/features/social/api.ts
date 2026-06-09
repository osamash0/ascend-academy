/** Supabase RPC wrappers + row→SocialUser mappers for the social feature. */
import { supabase } from "@/integrations/supabase/client";
import {
  initialsOf,
  type CourseChip,
  type FriendRequestItem,
  type RelationshipStatus,
  type Role,
  type SocialUser,
} from "./data";

// The social RPCs are added via migration and not in the generated types.
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as any)(name, args);

interface RpcUserRow {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  institution: string | null;
  social_roles: string[] | null;
  total_xp: number | null;
  weekly_xp?: number | null;
  current_level: number | null;
  current_streak?: number | null;
  active_today?: boolean | null;
  relationship?: RelationshipStatus | null;
  mutual_friends?: number | null;
  mutual_courses?: number | null;
  direction?: "incoming" | "outgoing";
  created_at?: string;
}

function mapUser(r: RpcUserRow): SocialUser {
  const name = r.display_name || "Learner";
  return {
    id: r.user_id,
    name,
    initials: initialsOf(name),
    avatarUrl: r.avatar_url,
    roles: (r.social_roles ?? []) as Role[],
    institution: r.institution ?? null,
    totalXp: r.total_xp ?? 0,
    weeklyXp: r.weekly_xp ?? 0,
    level: r.current_level ?? 1,
    streak: r.current_streak ?? 0,
    online: !!r.active_today,
    relationship: (r.relationship ?? undefined) as RelationshipStatus | undefined,
    mutualFriends: r.mutual_friends ?? undefined,
    mutualCourses: r.mutual_courses ?? undefined,
  };
}

/* ------------------------------- reads ------------------------------------ */

export async function fetchMySocialExtras(): Promise<{
  institution: string | null;
  roles: Role[];
  weeklyXp: number;
}> {
  const { data, error } = await rpc("get_my_social_extras");
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    institution: row?.institution ?? null,
    roles: (row?.social_roles ?? []) as Role[],
    weeklyXp: row?.weekly_xp ?? 0,
  };
}

export async function fetchWeeklyXpByDay(): Promise<{ day: string; xp: number }[]> {
  const { data, error } = await rpc("get_weekly_xp_by_day");
  if (error) throw error;
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return ((data as any[]) ?? []).map((r) => ({
    day: labels[new Date(r.day).getDay()] ?? "",
    xp: r.xp ?? 0,
  }));
}

export async function fetchFriends(): Promise<SocialUser[]> {
  const { data, error } = await rpc("get_friends");
  if (error) throw error;
  return ((data as RpcUserRow[]) ?? []).map((r) => ({
    ...mapUser(r),
    relationship: "friends" as RelationshipStatus,
  }));
}

export async function fetchFriendRequests(): Promise<FriendRequestItem[]> {
  const { data, error } = await rpc("get_friend_requests");
  if (error) throw error;
  return ((data as RpcUserRow[]) ?? []).map((r) => ({
    ...mapUser(r),
    relationship: (r.direction === "incoming" ? "incoming" : "pending_outgoing") as RelationshipStatus,
    direction: r.direction!,
    createdAt: r.created_at!,
  }));
}

export interface SearchParams {
  query?: string;
  institution?: string | null;
  role?: string | null;
  commonOnly?: boolean;
}

export async function searchUsers(p: SearchParams): Promise<SocialUser[]> {
  const { data, error } = await rpc("search_users", {
    p_query: p.query ?? "",
    p_institution: p.institution ?? null,
    p_role: p.role ?? null,
    p_common_only: p.commonOnly ?? false,
  });
  if (error) throw error;
  return ((data as RpcUserRow[]) ?? []).map(mapUser);
}

export async function fetchGlobalLeaderboard(): Promise<SocialUser[]> {
  const { data, error } = await rpc("get_global_leaderboard", { p_limit: 50 });
  if (error) throw error;
  return ((data as RpcUserRow[]) ?? []).map(mapUser);
}

export async function fetchUserProfile(userId: string): Promise<SocialUser | null> {
  const { data, error } = await rpc("get_user_profile", { p_user: userId });
  if (error) throw error;
  const row = (data as RpcUserRow[])?.[0];
  return row ? mapUser(row) : null;
}

export async function fetchUserCourses(userId: string): Promise<CourseChip[]> {
  const { data, error } = await rpc("get_user_courses", { p_user: userId });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    courseId: r.course_id,
    title: r.title,
    mutual: !!r.mutual,
  }));
}

/* ------------------------------ mutations --------------------------------- */

export async function sendFriendRequest(addresseeId: string): Promise<void> {
  const { error } = await rpc("send_friend_request", { p_addressee: addresseeId });
  if (error) throw error;
}
export async function respondFriendRequest(requesterId: string, accept: boolean): Promise<void> {
  const { error } = await rpc("respond_friend_request", { p_requester: requesterId, p_accept: accept });
  if (error) throw error;
}
export async function cancelFriendRequest(addresseeId: string): Promise<void> {
  const { error } = await rpc("cancel_friend_request", { p_addressee: addresseeId });
  if (error) throw error;
}
export async function removeFriend(userId: string): Promise<void> {
  const { error } = await rpc("remove_friend", { p_user: userId });
  if (error) throw error;
}
export async function setMySocialProfile(institution: string, roles: Role[]): Promise<void> {
  const { error } = await rpc("set_my_social_profile", { p_institution: institution, p_social_roles: roles });
  if (error) throw error;
}
export async function bootstrapDemoFriends(): Promise<string> {
  const { data, error } = await rpc("bootstrap_demo_friends");
  if (error) throw error;
  return (data as string) ?? "";
}
