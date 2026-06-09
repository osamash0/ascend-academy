import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Gem } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SocialUser } from "@/features/social/data";
import { useSocialUser } from "@/features/social/useSocialUser";
import { useGlobalLeaderboard } from "@/features/social/hooks";
import { LeaderboardRow } from "@/features/social/components/LeaderboardRow";
import { PodiumCard } from "@/features/social/components/PodiumCard";

type Period = "week" | "all";

export default function Leaderboard() {
  const me = useSocialUser();
  const { data: globalRows = [], isLoading: globalLoading } = useGlobalLeaderboard();

  const [period, setPeriod] = useState<Period>("week");

  // Filter and sort
  const ranked = useMemo<SocialUser[]>(() => {
    // We sort based on period. If week, sort by weeklyXp, else totalXp.
    return [...globalRows].sort((a, b) => {
      const vA = period === "week" ? a.weeklyXp : a.totalXp;
      const vB = period === "week" ? b.weeklyXp : b.totalXp;
      return vB - vA;
    });
  }, [period, globalRows]);

  const valueOf = (u: SocialUser) => (period === "week" ? u.weeklyXp : u.totalXp);
  const myIndex = ranked.findIndex((u) => u.id === me.id);
  const myRank = myIndex > -1 ? myIndex + 1 : "-";
  const meValue = myIndex > -1 ? valueOf(me) : 0;
  // Dynamic reward for the current user (e.g., 5% of points)
  const myReward = Math.max(0, Math.floor(meValue * 0.05));

  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full bg-[#070b14] overflow-x-hidden font-sans">
      {/* Background glow effect */}
      <div className="pointer-events-none absolute left-1/2 top-[-20%] h-[600px] w-[1000px] -translate-x-1/2 rounded-full bg-[#1e3a8a]/20 blur-[120px]" />
      
      <div className="relative mx-auto w-full max-w-5xl px-4 py-8 lg:px-8 lg:py-10">
        
        {/* Toggle Pill */}
        <div className="mb-16 flex justify-center">
          <div className="flex items-center rounded-full bg-white/5 p-1 backdrop-blur-md">
            <button
              onClick={() => setPeriod("week")}
              className={cn(
                "rounded-full px-8 py-2 text-sm font-semibold transition-colors",
                period === "week" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
              )}
            >
              Daily
            </button>
            <button
              onClick={() => setPeriod("all")}
              className={cn(
                "rounded-full px-8 py-2 text-sm font-semibold transition-colors",
                period === "all" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
              )}
            >
              Monthly
            </button>
          </div>
        </div>

        {globalLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : ranked.length === 0 ? (
          <p className="py-20 text-center text-muted-foreground">No learners yet.</p>
        ) : (
          <>
            {/* Podium */}
            {top3.length > 0 && (
              <div className="mb-12 flex flex-col items-end justify-center gap-4 sm:flex-row sm:gap-6 lg:gap-8 pt-10">
                {top3[1] && (
                  <PodiumCard
                    user={top3[1]}
                    rank={2}
                    points={valueOf(top3[1])}
                    prize={Math.max(10, Math.floor(valueOf(top3[1]) * 0.05))}
                  />
                )}
                {top3[0] && (
                  <PodiumCard
                    user={top3[0]}
                    rank={1}
                    points={valueOf(top3[0])}
                    prize={Math.max(10, Math.floor(valueOf(top3[0]) * 0.05))}
                  />
                )}
                {top3[2] && (
                  <PodiumCard
                    user={top3[2]}
                    rank={3}
                    points={valueOf(top3[2])}
                    prize={Math.max(10, Math.floor(valueOf(top3[2]) * 0.05))}
                  />
                )}
              </div>
            )}

            {/* User Rank Summary Box */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto mb-10 flex max-w-2xl items-center justify-center gap-2 rounded-2xl bg-white/[0.03] px-6 py-4 border border-white/5 backdrop-blur-md text-sm text-muted-foreground shadow-lg"
            >
              You earned <Gem className="h-4 w-4 text-blue-400 mx-1" fill="currentColor" /> <strong className="text-white">{myReward}</strong> today and we ranked {myRank} out of <strong className="text-white">{ranked.length}</strong> users
            </motion.div>

            {/* Table */}
            {rest.length > 0 && (
              <div className="mx-auto max-w-4xl rounded-[24px] border border-white/5 bg-[#0c0f1a]/80 p-2 shadow-2xl backdrop-blur-xl sm:p-4">
                <div className="grid grid-cols-[32px_minmax(0,1.5fr)_minmax(0,1fr)_100px_100px] items-center gap-3 px-4 pb-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Rank</span>
                  <span>User name</span>
                  <span>Level</span>
                  <span>Point</span>
                  <span className="text-right">Reward</span>
                </div>
                
                <div className="flex flex-col gap-1">
                  {rest.map((u, i) => (
                    <LeaderboardRow
                      key={u.id}
                      user={u}
                      rank={i + 4}
                      isMe={u.id === me.id}
                      value={valueOf(u)}
                      index={i}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
