import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Trophy, Users, BarChart3, Settings, LogOut, Rocket, BookOpen, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/NotificationBell';
import { ProfileChip } from './ProfileChip';

interface NavTab {
  label: string;
  to: string;
  icon: LucideIcon;
}

const STUDENT_TABS: NavTab[] = [
  { label: 'Home', to: '/dashboard', icon: Home },
  { label: 'Library', to: '/library', icon: BookOpen },
  { label: 'Trophies', to: '/achievements', icon: Trophy },
  { label: 'Ranking', to: '/leaderboard', icon: Users },
  { label: 'Insights', to: '/insights', icon: BarChart3 },
];

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-sm font-bold text-foreground tabular-nums">
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

/**
 * Console OS top bar: identity (left), tab nav (center), system tray (right).
 * The persistent chrome of the console experience.
 */
export function ConsoleTopBar() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-4 px-5 lg:px-10 py-3 bg-gradient-to-b from-[#070b14]/80 via-[#070b14]/30 to-transparent backdrop-blur-[2px]">
      {/* Left: brand + identity */}
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-primary to-secondary shadow-glow-primary hover:scale-105 transition-transform"
          aria-label="Home"
        >
          <Rocket className="h-6 w-6 text-white" />
        </button>
        <ProfileChip className="hidden md:flex" />
      </div>

      {/* Center: tabs */}
      <nav className="flex items-center gap-1">
        {STUDENT_TABS.map((tab) => {
          const isActive = location.pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                'console-focusable relative flex items-center gap-2 rounded-full px-3 lg:px-4 py-2 text-sm font-bold transition-colors',
                isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="consoleTab"
                  className="absolute inset-0 rounded-full bg-white/10"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <tab.icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10 hidden lg:inline">{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Right: system tray */}
      <div className="flex items-center gap-2 lg:gap-3">
        <LiveClock />
        <NotificationBell />
        <Link
          to="/settings"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </Link>
        <button
          onClick={handleSignOut}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
          aria-label="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
