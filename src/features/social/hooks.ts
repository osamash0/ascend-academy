/** React Query hooks + mutations over the social RPCs. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  bootstrapDemoFriends,
  cancelFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  fetchGlobalLeaderboard,
  fetchMySocialExtras,
  fetchUserCourses,
  fetchUserProfile,
  fetchWeeklyXpByDay,
  removeFriend,
  respondFriendRequest,
  searchUsers,
  sendFriendRequest,
  setMySocialProfile,
  type SearchParams,
} from "./api";
import type { Role } from "./data";

const KEYS = {
  friends: ["social", "friends"] as const,
  global: ["social", "global"] as const,
  requests: ["social", "requests"] as const,
  extras: ["social", "extras"] as const,
  weekly: ["social", "weekly"] as const,
  search: (p: SearchParams) => ["social", "search", p] as const,
  profile: (id: string) => ["social", "profile", id] as const,
  courses: (id: string) => ["social", "courses", id] as const,
};

export const useFriends = () => useQuery({ queryKey: KEYS.friends, queryFn: fetchFriends });
export const useGlobalLeaderboard = () =>
  useQuery({ queryKey: KEYS.global, queryFn: fetchGlobalLeaderboard });
export const useFriendRequests = () =>
  useQuery({ queryKey: KEYS.requests, queryFn: fetchFriendRequests });
export const useMySocialExtras = () =>
  useQuery({ queryKey: KEYS.extras, queryFn: fetchMySocialExtras });
export const useWeeklyXpByDay = () =>
  useQuery({ queryKey: KEYS.weekly, queryFn: fetchWeeklyXpByDay });
export const useSearchUsers = (params: SearchParams) =>
  useQuery({ queryKey: KEYS.search(params), queryFn: () => searchUsers(params) });
export const useUserProfile = (id: string | undefined) =>
  useQuery({ queryKey: KEYS.profile(id ?? ""), queryFn: () => fetchUserProfile(id!), enabled: !!id });
export const useUserCourses = (id: string | undefined) =>
  useQuery({ queryKey: KEYS.courses(id ?? ""), queryFn: () => fetchUserCourses(id!), enabled: !!id });

/** All friend-graph mutations, with cache invalidation. */
export function useFriendActions() {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "social" });

  const add = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Could not send request"),
  });
  const accept = useMutation({
    mutationFn: (requesterId: string) => respondFriendRequest(requesterId, true),
    onSuccess: () => { invalidate(); toast.success("Friend added"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not accept"),
  });
  const decline = useMutation({
    mutationFn: (requesterId: string) => respondFriendRequest(requesterId, false),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Could not decline"),
  });
  const cancel = useMutation({
    mutationFn: cancelFriendRequest,
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Could not cancel"),
  });
  const unfriend = useMutation({
    mutationFn: removeFriend,
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Could not remove"),
  });
  const bootstrap = useMutation({
    mutationFn: bootstrapDemoFriends,
    onSuccess: (r) => { invalidate(); if (r === "seeded") toast.success("Demo network loaded"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not load demo network"),
  });

  return { add, accept, decline, cancel, unfriend, bootstrap };
}

export function useSetSocialProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ institution, roles }: { institution: string; roles: Role[] }) =>
      setMySocialProfile(institution, roles),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "social" });
      toast.success("Profile updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update profile"),
  });
}
