/**
 * The signed-in user as a SocialUser. Identity + XP/level/streak come from the
 * real profile (useAuth); institution / social roles / weekly XP come from the
 * social RPC (get_my_social_extras). Keyed by auth user_id to match the
 * friends graph and all social RPCs.
 */
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { initialsOf, type Role, type SocialUser } from "./data";
import { useMySocialExtras } from "./hooks";

export function useSocialUser(): SocialUser {
  const { profile, role } = useAuth();
  const { data: extras } = useMySocialExtras();

  return useMemo<SocialUser>(() => {
    const name = profile?.display_name || profile?.full_name || "You";
    const baseRole: Role = role === "professor" ? "Professor" : "Student";
    const roles = (extras?.roles?.length ? extras.roles : [baseRole]) as Role[];

    return {
      id: profile?.user_id || "me",
      name,
      initials: initialsOf(name),
      avatarUrl: profile?.avatar_url ?? null,
      roles,
      institution: extras?.institution ?? null,
      totalXp: profile?.total_xp ?? 0,
      weeklyXp: extras?.weeklyXp ?? 0,
      level: profile?.current_level ?? 1,
      streak: profile?.current_streak ?? 0,
      online: true,
      isCurrentUser: true,
    };
  }, [profile, role, extras]);
}
