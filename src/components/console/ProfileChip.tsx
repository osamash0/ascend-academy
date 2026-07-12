import { useNavigate } from 'react-router-dom';
import { ChevronDown, Settings, TrendingUp, LogOut, User } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { StudentRoutes } from '@/lib/routes';
import { RankRing } from '@/components/RankRing';
import { rankForXp } from '@/lib/rank';
import { LunaAstronaut } from '../../../learnstation-luna/components/LunaAstronaut';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface ProfileChipProps {
  className?: string;
}

/**
 * Top-left identity chip — the console "gamertag": avatar + name + level/XP.
 * Acts as a trigger for the account menu (profile, settings, sign out) so the
 * identity isn't a dead end. Reads the authenticated profile; renders nothing
 * if unavailable.
 */
export function ProfileChip({ className }: ProfileChipProps) {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  if (!profile) return null;

  const name = profile.display_name || profile.full_name || 'Player';
  const initial = name.charAt(0).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const tier = rankForXp(profile.total_xp);
  const avatar = (
    <div className="relative h-11 w-11 shrink-0">
      <RankRing tier={tier} size="md">
        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] bg-gradient-to-br from-primary to-secondary shadow-glow-primary">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <LunaAstronaut variant="head" size="xs" phase="full" showShadow={false} animated={false} />
          )}
        </div>
      </RankRing>
    </div>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'group flex items-center gap-3 rounded-[16px] px-1.5 py-1 -mx-1.5 outline-none transition-all',
          'hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary/50',
          'data-[state=open]:bg-white/5 active:scale-[0.98]',
          className,
        )}
        aria-label="Open account menu"
      >
        {avatar}
        <div className="leading-tight text-left">
          <p className="flex items-center gap-1 text-sm font-black text-foreground">
            {name}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-hover:text-foreground group-data-[state=open]:rotate-180" />
          </p>
          <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground tabular-nums">
            <span className="text-primary">Lvl {profile.current_level}</span>
            <span className="text-white/20">·</span>
            <span>{profile.total_xp.toLocaleString()} XP</span>
          </p>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          {avatar}
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-foreground">{name}</p>
            <p className="truncate text-xs font-normal text-muted-foreground">{profile.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(role === 'student' ? StudentRoutes.PROFILE : '/settings')}>
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        {role === 'student' && (
          <DropdownMenuItem onClick={() => navigate(StudentRoutes.ASCENT)}>
            <TrendingUp className="mr-2 h-4 w-4" />
            My Ascent
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
