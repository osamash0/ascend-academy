import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StudentRoutes } from "@/lib/routes";
import { SOCIAL_ROLE_OPTIONS, type Role } from "../data";
import { useSocial } from "../store";
import { useSocialUser } from "../useSocialUser";
import { useFriends, useSetSocialProfile, useUserCourses, useWeeklyXpByDay } from "../hooks";
import { Avatar, InstitutionBadge, Panel, RoleBadges, SectionHeading } from "../components/atoms";
import { CourseChips, FriendsRow, PresenceCard, StatCards } from "../components/ProfileBlocks";

export default function SocialProfile() {
  const me = useSocialUser();
  const navigate = useNavigate();
  const { setRoleFilter } = useSocial();
  const { data: friends = [] } = useFriends();
  const { data: courses = [] } = useUserCourses(me.id);
  const [editing, setEditing] = useState(false);

  const pickRole = (r: Role) => {
    setRoleFilter(r);
    navigate(StudentRoutes.LEADERBOARD);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-0 lg:py-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
        <Panel>
          <div className="flex items-start gap-4">
            <Avatar user={me} size="xl" showDot />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-bold text-foreground">{me.name}</h1>
              <div className="mt-1">
                <InstitutionBadge institution={me.institution} />
              </div>
              <div className="mt-2.5">
                {me.roles.length > 0 ? (
                  <RoleBadges roles={me.roles} onPick={pickRole} />
                ) : (
                  <span className="text-sm text-muted-foreground">No roles set</span>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </div>

          {editing && <ProfileEditor institution={me.institution} roles={me.roles} onClose={() => setEditing(false)} />}

          <div className="mt-5">
            <StatCards user={me} friendsCount={friends.length} />
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <PresenceCard user={me} />
          <WeeklyXpChart />
        </div>

        <CourseChips courses={courses.map((c) => ({ ...c, mutual: false }))} title="Enrolled courses" />

        <FriendsRow friends={friends} />
      </motion.div>
    </div>
  );
}

function ProfileEditor({
  institution,
  roles,
  onClose,
}: {
  institution: string | null;
  roles: Role[];
  onClose: () => void;
}) {
  const [inst, setInst] = useState(institution ?? "");
  const [picked, setPicked] = useState<Role[]>(roles);
  const save = useSetSocialProfile();

  const toggle = (r: Role) =>
    setPicked((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Institution</label>
      <Input value={inst} onChange={(e) => setInst(e.target.value)} placeholder="e.g. Uni Marburg" className="mb-3 bg-background" />
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Roles</label>
      <div className="mb-4 flex flex-wrap gap-2">
        {SOCIAL_ROLE_OPTIONS.map((r) => (
          <button
            key={r}
            onClick={() => toggle(r)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition",
              picked.includes(r) ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /> Cancel</Button>
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ institution: inst, roles: picked }, { onSuccess: onClose })}
        >
          <Check className="h-4 w-4" /> Save
        </Button>
      </div>
    </div>
  );
}

function WeeklyXpChart() {
  const { data: log = [] } = useWeeklyXpByDay();
  const max = Math.max(...log.map((e) => e.xp), 1);
  const total = log.reduce((s, e) => s + e.xp, 0);
  return (
    <Panel>
      <SectionHeading right={<span className="text-sm font-bold text-primary">+{total} XP</span>}>This week</SectionHeading>
      <div className="flex items-end justify-between gap-2" style={{ height: 96 }}>
        {log.map((e, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height: "100%" }}>
            <div
              className="w-full rounded-md bg-gradient-to-t from-primary to-secondary"
              style={{ height: `${(e.xp / max) * 100}%`, minHeight: 4 }}
              title={`${e.xp} XP`}
            />
            <span className="text-xs text-muted-foreground">{e.day}</span>
          </div>
        ))}
        {log.length === 0 && <div className="flex-1 text-center text-sm text-muted-foreground">No XP yet this week</div>}
      </div>
    </Panel>
  );
}
