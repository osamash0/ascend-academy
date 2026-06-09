/** One leaderboard row — shared by the friends (rich) and global (real) views. */
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { StudentRoutes } from "@/lib/routes";
import { Badge } from "@/components/ui/badge";
import type { SocialUser } from "../data";
import { Avatar, InstitutionBadge } from "./atoms";

export function LeaderboardRow({
  user,
  rank,
  maxXp,
  mode,
  isMe,
  value,
  index = 0,
}: {
  user: SocialUser;
  rank: number;
  maxXp: number;
  /** "social" = friends view (weekly bar + institution); "global" = real (level). */
  mode: "social" | "global";
  isMe: boolean;
  /** Headline/bar metric (defaults: weekly for social, total for global). */
  value?: number;
  index?: number;
}) {
  const navigate = useNavigate();
  const isGold = rank === 1;
  const metric = value ?? (mode === "social" ? user.weeklyXp : user.totalXp);
  const barPct = maxXp > 0 ? (metric / maxXp) * 100 : 0;

  return (
    <motion.button
      type="button"
      onClick={() => navigate(isMe ? StudentRoutes.PROFILE : StudentRoutes.PROFILE_USER(user.id))}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className={cn(
        "group grid w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
        isGold && "bg-xp/10",
        isMe ? "border-l-2 border-[#3B82F6] bg-[#3B82F6]/10" : "border-l-2 border-transparent hover:bg-white/5",
      )}
      style={{
        gridTemplateColumns:
          mode === "social"
            ? "28px minmax(0,1.5fr) minmax(0,1fr) 120px 72px"
            : "28px minmax(0,1.6fr) 90px 120px 80px",
      }}
    >
      {/* Rank */}
      <span className={cn("text-center text-sm font-bold tabular-nums", isGold ? "text-xp" : "text-muted-foreground")}>
        {rank}
      </span>

      {/* Avatar + name */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar user={user} size="sm" showDot={mode === "social"} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-foreground">{isMe ? "You" : user.name}</div>
          {mode === "global" && <div className="text-xs text-muted-foreground">Level {user.level}</div>}
        </div>
      </div>

      {mode === "social" ? (
        <>
          <div className="min-w-0">
            <InstitutionBadge institution={user.institution} />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn("h-full rounded-full", isMe ? "bg-[#3B82F6]" : isGold ? "bg-xp" : "bg-primary")}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">+{user.weeklyXp}</span>
          </div>
        </>
      ) : (
        <>
          <Badge variant="outline" className="justify-self-start border-level/30 bg-level/10 font-medium text-level">
            Lvl {user.level}
          </Badge>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full", isMe ? "bg-[#3B82F6]" : isGold ? "bg-xp" : "bg-primary")}
              style={{ width: `${barPct}%` }}
            />
          </div>
        </>
      )}

      {/* Headline value */}
      <span className="text-right text-[15px] font-bold text-foreground tabular-nums">
        {metric.toLocaleString()}
      </span>
    </motion.button>
  );
}
