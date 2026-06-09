import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Crown, Info, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SOCIAL_ROLE_OPTIONS, type Role, type SocialUser } from "@/features/social/data";
import { useSocial } from "@/features/social/store";
import { useSocialUser } from "@/features/social/useSocialUser";
import { useFriends, useGlobalLeaderboard } from "@/features/social/hooks";
import { LeaderboardRow } from "@/features/social/components/LeaderboardRow";
import { Panel } from "@/features/social/components/atoms";

type Scope = "friends" | "global";
type Period = "week" | "all";

export default function Leaderboard() {
  const me = useSocialUser();
  const { roleFilter, setRoleFilter } = useSocial();
  const { data: friends = [] } = useFriends();
  const { data: globalRows = [], isLoading: globalLoading } = useGlobalLeaderboard();

  const [scope, setScope] = useState<Scope>("global");
  const [period, setPeriod] = useState<Period>("week");
  const [institution, setInstitution] = useState("all");

  const mode: "social" | "global" = scope === "friends" ? "social" : "global";
  const valueOf = (u: SocialUser) =>
    mode === "social" ? (period === "week" ? u.weeklyXp : u.totalXp) : u.totalXp;

  const institutions = useMemo(
    () => Array.from(new Set(friends.map((f) => f.institution).filter(Boolean))) as string[],
    [friends],
  );

  const ranked = useMemo<SocialUser[]>(() => {
    if (scope === "global") {
      // RPC already includes the signed-in user, sorted by total_xp.
      return [...globalRows].sort((a, b) => b.totalXp - a.totalXp);
    }
    let pool = [me, ...friends];
    if (institution !== "all") pool = pool.filter((u) => u.id === me.id || u.institution === institution);
    if (roleFilter) pool = pool.filter((u) => u.id === me.id || u.roles.includes(roleFilter));
    return pool.sort((a, b) => valueOf(b) - valueOf(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, period, institution, roleFilter, friends, me, globalRows]);

  const maxXp = Math.max(...ranked.map(valueOf), 1);
  const myIndex = ranked.findIndex((u) => u.id === me.id);
  const top = ranked.slice(0, 10);
  const myInTop = myIndex > -1 && myIndex < 10;
  const above = myIndex > 0 ? ranked[myIndex - 1] : null;
  const gap = above ? valueOf(above) - valueOf(me) : 0;

  const cols =
    mode === "social" ? "28px minmax(0,1.5fr) minmax(0,1fr) 120px 72px" : "28px minmax(0,1.6fr) 90px 120px 80px";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-0 lg:py-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-xp to-streak shadow-glow-xp">
          <Crown className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="font-display text-[22px] font-bold text-foreground">Ranking</h1>
          <p className="text-sm text-muted-foreground">See where you stand among friends and the world.</p>
        </div>
      </motion.div>

      <Panel className="mb-4 !p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <TabsList>
              <TabsTrigger value="friends">Friends</TabsTrigger>
              <TabsTrigger value="global">Global</TabsTrigger>
            </TabsList>
          </Tabs>

          {scope === "friends" && (
            <>
              <FilterSelect value={period} onChange={(v) => setPeriod(v as Period)} width={130}
                options={[{ value: "week", label: "This week" }, { value: "all", label: "All time" }]} />
              <FilterSelect value={roleFilter ?? "all"} onChange={(v) => setRoleFilter(v === "all" ? null : (v as Role))} width={150}
                options={[{ value: "all", label: "All roles" }, ...SOCIAL_ROLE_OPTIONS.map((r) => ({ value: r, label: r }))]} />
              <FilterSelect value={institution} onChange={setInstitution} width={180}
                options={[{ value: "all", label: "All institutions" }, ...institutions.map((i) => ({ value: i, label: i }))]} />
            </>
          )}
        </div>
      </Panel>

      <Panel className="!p-3 lg:!p-4">
        <div
          className="grid items-center gap-3 px-4 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: cols }}
        >
          <span className="text-center">#</span>
          <span>Learner</span>
          <span>{mode === "social" ? "Institution" : "Level"}</span>
          <span>{mode === "social" ? "Weekly XP" : "Total XP"}</span>
          <span className="text-right">{mode === "social" && period === "all" ? "Total" : mode === "social" ? "Weekly" : "Total"}</span>
        </div>

        {scope === "global" && globalLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : ranked.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {scope === "friends" ? "Add friends to see how you compare." : "No learners yet."}
          </p>
        ) : (
          <>
            <div key={`${scope}-${period}-${institution}-${roleFilter}`} className="flex flex-col gap-1">
              {top.map((u, i) => (
                <LeaderboardRow key={u.id} user={u} rank={i + 1} maxXp={maxXp} mode={mode} value={valueOf(u)} isMe={u.id === me.id} index={i} />
              ))}
            </div>

            {!myInTop && myIndex > -1 && (
              <>
                <div className="my-2 flex items-center gap-2 px-4 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  your position
                  <div className="h-px flex-1 bg-border" />
                </div>
                <LeaderboardRow user={me} rank={myIndex + 1} maxXp={maxXp} mode={mode} value={valueOf(me)} isMe index={myIndex} />
              </>
            )}

            {above && gap > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#3B82F6]/10 px-4 py-3 text-sm text-[#93C5FD]">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  You are <strong className="text-white">{gap.toLocaleString()} XP</strong> behind {above.name} — keep going to overtake them.
                </span>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width: number;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 rounded-full border-white/10 bg-white/5 text-sm" style={{ width }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
