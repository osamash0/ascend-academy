import { motion } from "framer-motion";
import { ChevronRight, UserPlus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StudentRoutes } from "@/lib/routes";
import { useFriendRequests, useFriends } from "../hooks";
import { Avatar, OnlineDot, Panel, SectionHeading } from "../components/atoms";
import { LiveActivityFeed } from "../components/LiveActivityFeed";

export default function FriendsHub() {
  const { data: friends = [], isLoading } = useFriends();
  const { data: requests = [] } = useFriendRequests();

  const online = friends.filter((f) => f.online);
  const incoming = requests.filter((r) => r.direction === "incoming");
  const empty = !isLoading && friends.length === 0 && requests.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 lg:px-0 lg:py-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-glow-primary">
            <Users className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-display text-[22px] font-bold text-foreground">Friends</h1>
            <p className="text-sm text-muted-foreground">Your study circle and who’s active now.</p>
          </div>
        </div>
        <Button asChild variant="default">
          <Link to={StudentRoutes.FRIENDS_FIND}>
            <UserPlus className="h-4 w-4" /> Find friends
          </Link>
        </Button>
      </motion.div>

      {empty ? (
        <Panel className="flex flex-col items-center gap-4 border-dashed py-12 text-center">
          <UserPlus className="h-8 w-8 text-primary" />
          <div>
            <p className="text-base font-bold text-foreground">Find your first study buddy</p>
            <p className="mt-1 text-sm text-muted-foreground">Search for classmates by name, institution, or shared courses.</p>
          </div>
          <Button asChild><Link to={StudentRoutes.FRIENDS_FIND}>Find friends</Link></Button>
        </Panel>
      ) : (
        <>
          {online.length > 0 && (
            <Panel className="mb-5">
              <div className="mb-3 flex items-center gap-2">
                <OnlineDot online pulse />
                <span className="text-sm font-bold text-foreground">
                  {online.length} {online.length === 1 ? "friend" : "friends"} active now
                </span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {online.map((u) => (
                  <Link
                    key={u.id}
                    to={StudentRoutes.PROFILE_USER(u.id)}
                    className="flex min-w-[180px] shrink-0 items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5 hover:bg-white/5"
                  >
                    <Avatar user={u} size="md" showDot />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-foreground">{u.name}</div>
                      <div className="truncate text-xs text-success">+{u.weeklyXp} XP this week</div>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SectionHeading right={<span className="text-sm text-muted-foreground">{friends.length} total</span>}>
                All friends
              </SectionHeading>
              <Panel className="!p-2">
                {friends.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No friends yet — add some from Find friends.</p>
                ) : (
                  friends.map((f) => (
                    <Link key={f.id} to={StudentRoutes.PROFILE_USER(f.id)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/5">
                      <Avatar user={f} size="md" showDot />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-foreground">{f.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{f.institution ?? "Self-taught"}</div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <span className="font-bold text-xp">{f.totalXp.toLocaleString()}</span> XP
                      </div>
                    </Link>
                  ))
                )}
              </Panel>
            </div>

            <div>
              <LiveActivityFeed />
              
              <div className="mt-5">
                <SectionHeading
                  right={
                    <Link to={StudentRoutes.FRIENDS_REQUESTS} className="flex items-center gap-1 text-sm text-primary">
                      View all <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                >
                Requests
              </SectionHeading>
              <Panel className="!p-2">
                {incoming.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No pending requests.</p>
                ) : (
                  incoming.map((u) => (
                    <Link key={u.id} to={StudentRoutes.FRIENDS_REQUESTS} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/5">
                      <Avatar user={u} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-foreground">{u.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.mutualFriends ?? 0} mutual friends</div>
                      </div>
                    </Link>
                  ))
                )}
              </Panel>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
