/** One leaderboard row — matching the new 5-column table design. */
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Gem, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { StudentRoutes } from "@/lib/routes";
import type { SocialUser } from "../data";
import { Avatar } from "./atoms";

export function LeaderboardRow({
  user,
  rank,
  isMe,
  value,
  index = 0,
}: {
  user: SocialUser;
  rank: number;
  isMe: boolean;
  value?: number;
  index?: number;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation('gamification');
  const metric = value ?? user.totalXp;
  // Calculate reward dynamically (e.g. 10% of points, capped or scaled as needed)
  // The design shows points like 2,114,424 and reward 1000.
  // We'll just derive a nice looking reward number for now.
  const reward = Math.max(10, Math.floor(metric * 0.05));

  return (
    <motion.button
      type="button"
      onClick={() => navigate(isMe ? StudentRoutes.PROFILE : StudentRoutes.PROFILE_USER(user.id))}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className={cn(
        "group grid w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors",
        isMe ? "bg-[#1e243b]/80 border border-[#3B82F6]/30" : "hover:bg-white/[0.02] border border-transparent"
      )}
      style={{
        gridTemplateColumns: "32px minmax(0, 1.5fr) minmax(0, 1fr) 100px 100px",
      }}
    >
      {/* Rank */}
      <span className="text-sm font-bold tabular-nums text-white">
        {rank}
      </span>

      {/* Avatar + name */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar user={user} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-1 truncate text-sm font-bold text-white">
            <span className="truncate">{isMe ? t('leaderboard.you') : user.name}</span>
            {user.institutionVerified && (
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-blue-400" aria-label="Verified institution" />
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">@{user.name.toLowerCase().replace(/\s+/g, '')}</div>
        </div>
      </div>

      {/* Followers / Level */}
      <div className="text-sm font-medium text-white">
        {t('leaderboard.levelValue', { level: user.level })}
      </div>

      {/* Point */}
      <div className="text-sm font-medium text-white tabular-nums">
        {metric.toLocaleString()}
      </div>

      {/* Reward */}
      <div className="flex items-center gap-1.5 justify-end rounded-md bg-[#1a2133] px-2 py-1 border border-white/5 w-fit">
        <Gem className="h-3.5 w-3.5 text-blue-400" fill="currentColor" />
        <span className="text-xs font-bold text-white tabular-nums">{reward.toLocaleString()}</span>
      </div>
    </motion.button>
  );
}

