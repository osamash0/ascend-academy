/** Shared dark-theme primitives for the social layer. */
import { Check, Flame } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { RankRing } from "@/components/RankRing";
import { rankForXp, type RankTier } from "@/lib/rank";
import { avatarGradient, type Role, type SocialUser } from "../data";

/* ------------------------------ Avatar ---------------------------- */

const AVATAR_SIZES = { sm: 36, md: 44, lg: 56, xl: 80 } as const;

export function Avatar({
  user,
  size = "md",
  showDot = false,
  rankTier,
  showRank = true,
}: {
  // `totalXp` (optional) drives the rank border; all SocialUser callers carry it.
  user: Pick<SocialUser, "id" | "initials" | "online" | "avatarUrl"> & { totalXp?: number };
  size?: keyof typeof AVATAR_SIZES;
  showDot?: boolean;
  /** Explicit tier override (e.g. when XP isn't on the user object). */
  rankTier?: RankTier;
  /** Opt out of the rank border entirely. */
  showRank?: boolean;
}) {
  const px = AVATAR_SIZES[size];
  const [from, to] = avatarGradient(user.id);
  const tier = rankTier ?? (user.totalXp != null ? rankForXp(user.totalXp) : undefined);
  const showRing = showRank && tier != null;

  const inner = (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] shadow-glow-primary"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-display font-black text-white" style={{ fontSize: px * 0.36 }}>
          {user.initials}
        </span>
      )}
    </div>
  );

  return (
    <div className="relative shrink-0" style={{ width: px, height: px }}>
      {showRing ? (
        <RankRing tier={tier!} size={size}>
          {inner}
        </RankRing>
      ) : (
        inner
      )}
      {showDot && (
        <span className="absolute -bottom-0.5 -right-0.5 z-10 rounded-full ring-2 ring-[#0E1320]">
          <OnlineDot online={user.online} pulse={user.online} />
        </span>
      )}
    </div>
  );
}

/* ---------------------------- OnlineDot --------------------------- */

export function OnlineDot({
  online,
  pulse = false,
  size = 10,
}: {
  online: boolean;
  pulse?: boolean;
  size?: number;
}) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {online && pulse && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
      )}
      <span
        className={cn("relative inline-flex rounded-full", online ? "bg-success" : "bg-muted-foreground/40")}
        style={{ width: size, height: size }}
      />
    </span>
  );
}

/* ------------------------------ Badges ---------------------------- */

const ROLE_STYLES: Record<Role, string> = {
  Student: "bg-primary/15 text-primary border-primary/20",
  "Self-learner": "bg-success/15 text-success border-success/20",
  Tutor: "bg-accent/15 text-accent border-accent/25",
  Researcher: "bg-xp/15 text-xp border-xp/20",
  Professor: "bg-secondary/15 text-secondary border-secondary/20",
};

export function RoleBadge({ role, onClick }: { role: Role; onClick?: () => void }) {
  return (
    <Badge
      variant="outline"
      onClick={onClick}
      title={onClick ? `Filter ranking by ${role}` : undefined}
      className={cn("font-medium", ROLE_STYLES[role], onClick && "cursor-pointer hover:brightness-125 transition")}
    >
      {role}
    </Badge>
  );
}

export function RoleBadges({ roles, onPick }: { roles: Role[]; onPick?: (r: Role) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((r) => (
        <RoleBadge key={r} role={r} onClick={onPick ? () => onPick(r) : undefined} />
      ))}
    </div>
  );
}

export function InstitutionBadge({ institution }: { institution: string | null }) {
  return (
    <Badge variant="outline" className="border-border bg-white/5 font-medium text-muted-foreground">
      {institution ?? "Self-taught"}
    </Badge>
  );
}

export function VerifiedInstitution({ institution }: { institution: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success/20">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      {institution}
    </span>
  );
}

/* ---------------------------- StreakValue ------------------------- */

export function StreakValue({ streak, className }: { streak: number; className?: string }) {
  const hot = streak > 7;
  return (
    <span className={cn("inline-flex items-center gap-1.5", hot ? "text-streak" : "text-foreground", className)}>
      <Flame className={cn("h-5 w-5", hot ? "text-streak" : "text-muted-foreground")} fill={hot ? "currentColor" : "none"} />
      {streak}
    </span>
  );
}

/* ---------------------------- Glass panels ------------------------ */

export function Panel({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn("glass-card rounded-[24px] border border-white/5 p-5 lg:p-6", className)}>
      {children}
    </div>
  );
}

export function StatTile({ label, value, accentClass }: { label: string; value: ReactNode; accentClass?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-display text-[22px] font-bold leading-none", accentClass ?? "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

export function SectionHeading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-lg font-bold text-foreground">{children}</h2>
      {right}
    </div>
  );
}
