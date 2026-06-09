import { motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StudentRoutes } from "@/lib/routes";
import type { Role } from "../data";
import { useSocial } from "../store";
import { useSocialUser } from "../useSocialUser";
import { useFriendActions, useUserCourses, useUserProfile } from "../hooks";
import { Avatar, InstitutionBadge, Panel, RoleBadges, SectionHeading } from "../components/atoms";
import { FriendButton } from "../components/FriendButton";
import { CourseChips, LockedSection, MutualCoursesCard, MutualFriendsLine, PresenceCard, StatCards } from "../components/ProfileBlocks";

export default function FriendProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const me = useSocialUser();
  const { setRoleFilter } = useSocial();
  const { accept, decline } = useFriendActions();
  const { data: user, isLoading } = useUserProfile(userId);
  const { data: courses = [] } = useUserCourses(userId);

  if (userId && me.id === userId) return <Navigate to={StudentRoutes.PROFILE} replace />;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 lg:px-0">
        <Panel>
          <p className="text-foreground">This learner could not be found.</p>
          <Link to={StudentRoutes.FRIENDS_FIND} className="text-sm text-primary">Find friends</Link>
        </Panel>
      </div>
    );
  }

  const isFriend = user.relationship === "friends";
  const isIncoming = user.relationship === "incoming";
  const pickRole = (r: Role) => {
    setRoleFilter(r);
    navigate(StudentRoutes.LEADERBOARD);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-0 lg:py-8">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
        <Panel>
          <div className="flex items-start gap-4">
            <Avatar user={user} size="xl" showDot />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-bold text-foreground">{user.name}</h1>
              <div className="mt-1">
                <InstitutionBadge institution={user.institution} />
              </div>
              {user.roles.length > 0 && (
                <div className="mt-2.5">
                  <RoleBadges roles={user.roles} onPick={pickRole} />
                </div>
              )}
            </div>
            {isIncoming ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => accept.mutate(user.id)} disabled={accept.isPending}>
                  <Check className="h-4 w-4" /> Accept
                </Button>
                <Button size="sm" variant="outline" onClick={() => decline.mutate(user.id)} disabled={decline.isPending}>
                  <X className="h-4 w-4" /> Decline
                </Button>
              </div>
            ) : (
              <FriendButton userId={user.id} relationship={user.relationship} />
            )}
          </div>
          <div className="mt-5">
            <StatCards user={user} friendsCount={user.mutualFriends ?? 0} />
          </div>
          {!isFriend && (
            <div className="mt-3">
              <MutualFriendsLine count={user.mutualFriends ?? 0} />
            </div>
          )}
        </Panel>

        <MutualCoursesCard courses={courses} />

        {isFriend ? <PresenceCard user={user} /> : <LockedSection label="Live activity" />}

        {isFriend ? (
          <CourseChips courses={courses} title="Courses" />
        ) : (
          <div>
            <SectionHeading>Courses</SectionHeading>
            <LockedSection label="Enrolled courses" />
          </div>
        )}

        {!isFriend && !isIncoming && (
          <Panel className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">
              Add {user.name.split(" ")[0]} to see their full profile and activity.
            </span>
            <FriendButton userId={user.id} relationship={user.relationship} />
          </Panel>
        )}
      </motion.div>
    </div>
  );
}
