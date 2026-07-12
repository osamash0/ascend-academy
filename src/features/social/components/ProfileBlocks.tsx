/** Reusable profile sections (dark theme), backed by live data. */
import { BookOpen, Lock, Users, HandMetal } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { StudentRoutes } from "@/lib/routes";
import type { CourseChip, SocialUser } from "../data";
import { useSocial } from "../store";
import { Avatar, OnlineDot, Panel, SectionHeading, StatTile, StreakValue } from "./atoms";

export function StatCards({ user, friendsCount }: { user: SocialUser; friendsCount: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Weekly XP" value={`+${user.weeklyXp}`} accentClass="text-primary" />
      <StatTile label="Total XP" value={user.totalXp.toLocaleString()} accentClass="text-xp" />
      <StatTile label="Day streak" value={<StreakValue streak={user.streak} />} />
      <StatTile label="Friends" value={friendsCount} />
    </div>
  );
}

export function PresenceCard({ user }: { user: SocialUser }) {
  const { onlineUserIds, sendNudge } = useSocial();
  const isOnline = onlineUserIds.has(user.id) || user.online;

  return (
    <Panel className="flex items-center gap-4">
      <OnlineDot online={isOnline} pulse={isOnline} />
      <div className="flex-1">
        <div className="text-sm font-bold text-foreground">{isOnline ? "Active today" : "Offline"}</div>
        <div className="text-xs text-muted-foreground">
          {isOnline ? `Earned +${user.weeklyXp} XP this week` : "No activity in the last 24h"}
        </div>
      </div>
      {isOnline && (
        <button
          onClick={() => sendNudge(user.id, user.name)}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
        >
          <HandMetal className="h-4 w-4" /> Nudge
        </button>
      )}
    </Panel>
  );
}

export function CourseChips({
  courses,
  title = "Courses",
}: {
  courses: CourseChip[];
  title?: string;
}) {
  return (
    <div>
      <SectionHeading>{title}</SectionHeading>
      {courses.length === 0 ? (
        <Panel className="text-sm text-muted-foreground">No enrolled courses yet.</Panel>
      ) : (
        <div className="flex flex-wrap gap-2">
          {courses.map((c) => (
            <span
              key={c.courseId}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium",
                c.mutual ? "border-primary/40 bg-primary/10 text-foreground" : "border-white/10 bg-white/[0.03] text-foreground",
              )}
            >
              <BookOpen className={cn("h-4 w-4", c.mutual ? "text-primary" : "text-muted-foreground")} />
              {c.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function FriendsRow({ friends }: { friends: SocialUser[] }) {
  return (
    <div>
      <SectionHeading>Friends · {friends.length}</SectionHeading>
      {friends.length === 0 ? (
        <Panel className="text-sm text-muted-foreground">No friends yet.</Panel>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {friends.map((f) => (
            <Link
              key={f.id}
              to={StudentRoutes.PROFILE_USER(f.id)}
              className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center"
            >
              <Avatar user={f} size="lg" showDot />
              <span className="w-16 truncate text-xs text-muted-foreground">{f.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function LockedSection({ label }: { label: string }) {
  return (
    <Panel className="border-dashed">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" /> {label} are visible once you’re friends
      </div>
    </Panel>
  );
}

export function MutualCoursesCard({ courses }: { courses: CourseChip[] }) {
  const mutual = courses.filter((c) => c.mutual);
  if (mutual.length === 0) return null;
  return (
    <Panel className="border-primary/30 bg-primary/5">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-primary">
        <BookOpen className="h-4 w-4" /> {mutual.length} mutual {mutual.length === 1 ? "course" : "courses"}
      </div>
      <div className="flex flex-wrap gap-2">
        {mutual.map((c) => (
          <span key={c.courseId} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-foreground">
            {c.title}
          </span>
        ))}
      </div>
    </Panel>
  );
}

export function MutualFriendsLine({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Users className="h-4 w-4" /> {count} mutual friends
    </div>
  );
}
