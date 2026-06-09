import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Loader2, Search, Users, Sparkles, BadgeCheck, GraduationCap } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StudentRoutes } from "@/lib/routes";
import { SOCIAL_ROLE_OPTIONS, type SocialUser } from "../data";
import { useFriendSuggestions, useSearchUsers } from "../hooks";
import { Avatar, InstitutionBadge, Panel, RoleBadges } from "../components/atoms";
import { FriendButton } from "../components/FriendButton";

function PersonCard({ u, i }: { u: SocialUser; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
      <Panel className="!p-4">
        <div className="flex items-start gap-3">
          <Link to={StudentRoutes.PROFILE_USER(u.id)}><Avatar user={u} size="lg" showDot /></Link>
          <div className="min-w-0 flex-1">
            <Link to={StudentRoutes.PROFILE_USER(u.id)} className="flex items-center gap-1 truncate text-[15px] font-bold text-foreground hover:text-primary">
              <span className="truncate">{u.name}</span>
              {u.institutionVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-blue-400" aria-label="Verified institution" />}
            </Link>
            <div className="mt-0.5"><InstitutionBadge institution={u.institution} /></div>
            {u.roles.length > 0 && <div className="mt-2"><RoleBadges roles={u.roles} /></div>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {u.mutualFriends ?? 0} mutual</span>
          {(u.sharedCourses ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-primary"><GraduationCap className="h-3.5 w-3.5" /> {u.sharedCourses} shared {u.sharedCourses === 1 ? "course" : "courses"}</span>
          )}
          {(u.mutualCourses ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-primary"><BookOpen className="h-3.5 w-3.5" /> {u.mutualCourses} on platform</span>
          )}
        </div>
        <div className="mt-3"><FriendButton userId={u.id} relationship={u.relationship} full /></div>
      </Panel>
    </motion.div>
  );
}

export default function FindFriends() {
  const [params] = useSearchParams();
  const [raw, setRaw] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(raw);
  const [institution, setInstitution] = useState("all");
  const [role, setRole] = useState("all");
  const [commonOnly, setCommonOnly] = useState(false);

  // debounce the text query
  useEffect(() => {
    const t = setTimeout(() => setQuery(raw), 250);
    return () => clearTimeout(t);
  }, [raw]);

  const { data: results = [], isFetching } = useSearchUsers({
    query,
    institution: institution === "all" ? null : institution,
    role: role === "all" ? null : role,
    commonOnly,
  });

  // "Suggested for you" — only when the user hasn't started searching/filtering.
  const showSuggestions = !query.trim() && institution === "all" && role === "all" && !commonOnly;
  const { data: suggestions = [], isLoading: suggLoading } = useFriendSuggestions(8);

  // institution options derived from current results (no all-institutions RPC).
  const institutions = useMemo(
    () => Array.from(new Set(results.map((u) => u.institution).filter(Boolean))) as string[],
    [results],
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-0 lg:py-8">
      <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-5 font-display text-[22px] font-bold text-foreground">
        Find friends
      </motion.h1>

      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Search by name or institution…"
          className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-base"
        />
        {isFetching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select value={institution} onValueChange={setInstitution}>
          <SelectTrigger className="h-9 w-[180px] rounded-full border-white/10 bg-white/5 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All institutions</SelectItem>
            {institutions.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-9 w-[150px] rounded-full border-white/10 bg-white/5 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {SOCIAL_ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <button
          onClick={() => setCommonOnly((v) => !v)}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
            commonOnly ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
          )}
        >
          <BookOpen className="h-4 w-4" /> Shared courses
        </button>
        <span className="ml-auto text-sm text-muted-foreground">{results.length} {results.length === 1 ? "person" : "people"}</span>
      </div>

      {showSuggestions && (suggLoading || suggestions.length > 0) && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-display text-[15px] font-bold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" /> Suggested for you
            <span className="text-xs font-normal text-muted-foreground">· from your courses, program & semester</span>
          </h2>
          {suggLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {suggestions.map((u, i) => <PersonCard key={u.id} u={u} i={i} />)}
            </div>
          )}
        </section>
      )}

      {results.length === 0 ? (
        <Panel className="text-sm text-muted-foreground">{isFetching ? "Searching…" : "No learners match your search."}</Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {results.map((u, i) => <PersonCard key={u.id} u={u} i={i} />)}
        </div>
      )}
    </div>
  );
}
