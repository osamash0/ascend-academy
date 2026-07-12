import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Gem, BadgeCheck } from "lucide-react";
import { LunaLoader } from "../../learnstation-luna";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type SocialUser } from "@/features/social/data";
import { useSocialUser } from "@/features/social/useSocialUser";
import { useGlobalLeaderboard } from "@/features/social/hooks";
import { LeaderboardRow } from "@/features/social/components/LeaderboardRow";
import { PodiumCard } from "@/features/social/components/PodiumCard";

type Period = "week" | "all";

export default function Leaderboard() {
  const { t } = useTranslation('gamification');
  const me = useSocialUser();
  const { data: globalRows = [], isLoading: globalLoading } = useGlobalLeaderboard();

  const [period, setPeriod] = useState<Period>("week");

  // Academic cohort filters (client-side over the fetched rows).
  const [university, setUniversity] = useState("all");
  const [faculty, setFaculty] = useState("all");
  const [semester, setSemester] = useState("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const universities = useMemo(
    () => Array.from(new Set(globalRows.map((u) => u.universityName).filter(Boolean))) as string[],
    [globalRows],
  );
  const faculties = useMemo(
    () =>
      Array.from(
        new Set(
          globalRows
            .filter((u) => university === "all" || u.universityName === university)
            .map((u) => u.facultyName)
            .filter(Boolean),
        ),
      ) as string[],
    [globalRows, university],
  );
  const semesters = useMemo(
    () =>
      Array.from(new Set(globalRows.map((u) => u.currentSemester).filter((s): s is number => s != null))).sort(
        (a, b) => a - b,
      ),
    [globalRows],
  );

  // Filter then sort by the selected period.
  const ranked = useMemo<SocialUser[]>(() => {
    return globalRows
      .filter((u) => university === "all" || u.universityName === university)
      .filter((u) => faculty === "all" || u.facultyName === faculty)
      .filter((u) => semester === "all" || String(u.currentSemester) === semester)
      .filter((u) => !verifiedOnly || u.institutionVerified)
      .sort((a, b) => {
        const vA = period === "week" ? a.weeklyXp : a.totalXp;
        const vB = period === "week" ? b.weeklyXp : b.totalXp;
        return vB - vA;
      });
  }, [period, globalRows, university, faculty, semester, verifiedOnly]);

  const filtersActive = university !== "all" || faculty !== "all" || semester !== "all" || verifiedOnly;

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
              {t('leaderboard.thisWeek')}
            </button>
            <button
              onClick={() => setPeriod("all")}
              className={cn(
                "rounded-full px-8 py-2 text-sm font-semibold transition-colors",
                period === "all" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
              )}
            >
              {t('leaderboard.allTime')}
            </button>
          </div>
        </div>

        {/* Cohort filters — powered by the academic fingerprint */}
        {(universities.length > 0 || filtersActive) && (
          <div className="mb-10 flex flex-wrap items-center justify-center gap-2.5">
            <Select value={university} onValueChange={(v) => { setUniversity(v); setFaculty("all"); }}>
              <SelectTrigger className="h-9 w-[190px] rounded-full border-white/10 bg-white/5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('leaderboard.allUniversities')}</SelectItem>
                {universities.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={faculty} onValueChange={setFaculty} disabled={faculties.length === 0}>
              <SelectTrigger className="h-9 w-[170px] rounded-full border-white/10 bg-white/5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('leaderboard.allFaculties')}</SelectItem>
                {faculties.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={semester} onValueChange={setSemester} disabled={semesters.length === 0}>
              <SelectTrigger className="h-9 w-[140px] rounded-full border-white/10 bg-white/5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('leaderboard.anySemester')}</SelectItem>
                {semesters.map((s) => <SelectItem key={s} value={String(s)}>{t('leaderboard.semester', { n: s })}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              onClick={() => setVerifiedOnly((v) => !v)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
                verifiedOnly ? "border-blue-400/40 bg-blue-400/15 text-blue-300" : "border-white/10 bg-white/5 text-muted-foreground hover:text-white",
              )}
            >
              <BadgeCheck className="h-4 w-4" /> {t('leaderboard.verifiedOnly')}
            </button>
          </div>
        )}

        {globalLoading ? (
          <div className="flex justify-center py-20"><LunaLoader type="orbit-ring" size={64} /></div>
        ) : ranked.length === 0 ? (
          <p className="py-20 text-center text-muted-foreground">{t('leaderboard.noLearners')}</p>
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
              <Gem className="h-4 w-4 text-blue-400 mx-1" fill="currentColor" />
              {t('leaderboard.rankSummary', { reward: myReward, rank: myRank, total: ranked.length })}
            </motion.div>

            {/* Table */}
            {rest.length > 0 && (
              <div className="mx-auto max-w-4xl rounded-[24px] border border-white/5 bg-[#0c0f1a]/80 p-2 shadow-2xl backdrop-blur-xl sm:p-4">
                <div className="grid grid-cols-[32px_minmax(0,1.5fr)_minmax(0,1fr)_100px_100px] items-center gap-3 px-4 pb-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{t('leaderboard.columns.rank')}</span>
                  <span>{t('leaderboard.columns.user')}</span>
                  <span>{t('leaderboard.columns.level')}</span>
                  <span>{t('leaderboard.columns.points')}</span>
                  <span className="text-right">{t('leaderboard.columns.reward')}</span>
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
