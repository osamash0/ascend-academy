import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Trophy, Gem, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SocialUser } from "../data";
import { Avatar } from "./atoms";

interface PodiumCardProps {
  user: SocialUser;
  rank: 1 | 2 | 3;
  points: number;
  prize: number;
}

const rankStyles = {
  1: {
    height: "h-[376px]",
    yOffset: "-translate-y-8",
    trophyColor: "text-yellow-400",
    glow: "shadow-[0_0_40px_rgba(250,204,21,0.15)]",
    bg: "bg-gradient-to-b from-[#1a1f33]/80 to-[#0c0f1a]/90",
  },
  2: {
    height: "h-[280px]",
    yOffset: "translate-y-4",
    trophyColor: "text-slate-300",
    glow: "shadow-[0_0_30px_rgba(255,255,255,0.05)]",
    bg: "bg-gradient-to-b from-[#151929]/80 to-[#0a0d14]/90",
  },
  3: {
    height: "h-[280px]",
    yOffset: "translate-y-4",
    trophyColor: "text-amber-600",
    glow: "shadow-[0_0_30px_rgba(217,119,6,0.05)]",
    bg: "bg-gradient-to-b from-[#151929]/80 to-[#0a0d14]/90",
  },
};

export function PodiumCard({ user, rank, points, prize }: PodiumCardProps) {
  const { t } = useTranslation('gamification');
  const styles = rankStyles[rank];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.1 }}
      className={cn(
        "relative flex w-full max-w-[240px] flex-col items-center",
        styles.yOffset
      )}
    >
      {/* Avatar placed half inside, half outside the card */}
      <div className="absolute -top-14 z-10">
        <div className="rounded-[20px] bg-[#0c0f1a] p-1.5 shadow-xl">
          <Avatar user={user} size={rank === 1 ? "xl" : "lg"} />
        </div>
      </div>

      {/* Card Body */}
      <div
        className={cn(
          "flex w-full flex-col items-center justify-end rounded-2xl border border-white/5 pt-16 pb-6 text-center backdrop-blur-md transition-transform hover:-translate-y-2",
          styles.height,
          styles.bg,
          styles.glow
        )}
      >
        <h3 className="mb-6 font-display text-xl font-bold text-white line-clamp-1 px-4">
          {user.name}
        </h3>

        {/* Trophy & Points */}
        <div className="mb-5 flex flex-col items-center gap-1.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
            <Trophy className={cn("h-5 w-5", styles.trophyColor)} fill="currentColor" />
          </div>
          <span className="text-xs text-muted-foreground">{t('leaderboard.earnPoints', { points: points.toLocaleString() })}</span>
        </div>

        {/* Diamond Prize */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <Gem className="h-5 w-5 text-blue-400" fill="currentColor" />
            <span className="text-2xl font-black tabular-nums tracking-tight text-white">
              {prize.toLocaleString()}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('leaderboard.prize')}</span>
        </div>

        {/* Center rank timer */}
        {rank === 1 && (
          <div className="mt-6 flex flex-col items-center gap-1">
            <Clock className="h-4 w-4 text-[#3B82F6]" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('leaderboard.endsIn')}</span>
            <span className="text-xs font-bold text-white tabular-nums">10d 23h 59m 29s</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
