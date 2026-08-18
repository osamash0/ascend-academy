import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Home, TrendingUp, BarChart3, Users, Crown, Settings, LogOut, Rocket, BookOpen, LayoutDashboard, Archive, Upload, FolderOpen, Search, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { FEATURES } from '@/lib/featureFlags';
import { NotificationBell } from '@/components/NotificationBell';
import { UploadsIndicator } from '@/components/UploadsIndicator';
import { ProfileChip } from './ProfileChip';
import { StudentRoutes, PublicRoutes, SharedRoutes, ProfessorRoutes, AdminRoutes } from '@/lib/routes';

interface NavTab {
  label: string;
  labelKey?: string;
  to: string;
  icon: LucideIcon;
}

const STUDENT_TABS: NavTab[] = [
  { label: 'Home', to: StudentRoutes.HOME, icon: Home },
  { label: 'Library', to: StudentRoutes.LIBRARY, icon: BookOpen },
  { label: 'My Materials', labelKey: 'student.materials', to: StudentRoutes.MY_MATERIALS, icon: FolderOpen },
  { label: 'Ascent', to: StudentRoutes.ASCENT, icon: TrendingUp },
  { label: 'Ranking', to: StudentRoutes.LEADERBOARD, icon: Crown },
  { label: 'Friends', to: StudentRoutes.FRIENDS, icon: Users },
];

const PROFESSOR_TABS: NavTab[] = [
  { label: 'Dashboard', to: ProfessorRoutes.DASHBOARD, icon: LayoutDashboard },
  { label: 'Courses', to: ProfessorRoutes.COURSES, icon: BookOpen },
  { label: 'Archive', to: ProfessorRoutes.ARCHIVE, icon: Archive },
  { label: 'Analytics', to: ProfessorRoutes.ANALYTICS, icon: BarChart3 },
  { label: 'Upload', to: ProfessorRoutes.UPLOAD, icon: Upload },
];

const ADMIN_TABS: NavTab[] = [
  { label: 'Admin Panel', to: AdminRoutes.DASHBOARD, icon: LayoutDashboard },
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
interface ConsoleTopBarProps {
  onOpenSearch?: () => void;
}

export function ConsoleTopBar({ onOpenSearch }: ConsoleTopBarProps = {}) {
  const { signOut, role } = useAuth();
  const { t } = useTranslation(['nav']);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate(PublicRoutes.LANDING);
  };

  const studentTabs = FEATURES.studentUploads
    ? STUDENT_TABS
    : STUDENT_TABS.filter((tab) => tab.to !== StudentRoutes.MY_MATERIALS);
  const tabs = role === 'admin' ? ADMIN_TABS : (role === 'professor' ? PROFESSOR_TABS : studentTabs);
  const homeRoute = role === 'admin' ? AdminRoutes.DASHBOARD : (role === 'professor' ? ProfessorRoutes.DASHBOARD : StudentRoutes.HOME);

  // Publish this header's real rendered height so page-level sticky bars
  // (e.g. the lecture editor's action bar, M5) can stick just below it
  // instead of guessing a pixel value that drifts with content/breakpoint
  // changes and ends up sliding underneath this header at scroll.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setVar = (height: number) => {
      document.documentElement.style.setProperty('--console-header-height', `${height}px`);
    };
    setVar(el.offsetHeight);
    // Re-read offsetHeight (border-box) rather than trusting contentRect,
    // which excludes this header's padding/border and would under-measure.
    const obs = new ResizeObserver(() => setVar(el.offsetHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <header ref={headerRef} className="sticky top-0 z-40 flex items-center justify-between gap-4 px-5 lg:px-10 py-3 bg-gradient-to-b from-[#070b14]/80 via-[#070b14]/30 to-transparent backdrop-blur-[2px]">
      {/* Left: brand + identity.
          M24/M44: this group used to be allowed to flex-shrink freely
          (`min-w-0`, no `shrink-0`) while its content (the rocket Home
          button + ProfileChip) had no size floor of its own. Under real
          content pressure - a long display name, a narrower viewport - the
          flex algorithm computed a near-zero box for this group but the
          unclipped content still rendered at full size, silently overlapping
          the center nav (its Home tab link ended up sitting entirely inside
          the account-menu's hit area). `shrink-0` here plus a capped name
          width in ProfileChip means this group has a real, bounded natural
          size the layout can actually respect. */}
      <div className="flex shrink-0 items-center gap-4">
        <button
          onClick={() => navigate(homeRoute)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-primary to-secondary shadow-glow-primary hover:scale-105 transition-transform"
          aria-label="Home"
        >
          <Rocket className="h-6 w-6 text-white" />
        </button>
        <ProfileChip className="hidden md:flex" />
      </div>

      {/* Center: tabs */}
      <nav className="flex items-center gap-1">
        {tabs.map((tab) => {
          const isActive = location.pathname.startsWith(tab.to);
          const label = tab.labelKey ? t(tab.labelKey) : tab.label;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
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
              <span className="relative z-10 hidden lg:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Right: system tray */}
      <div className="flex items-center gap-2 lg:gap-3">
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="console-focusable flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
            aria-label="Search"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Ask anything</span>
            <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 text-[10px] font-black lg:inline">⌘K</kbd>
          </button>
        )}
        <LiveClock />
        {(role === 'professor' || role === 'student') && <UploadsIndicator />}
        <NotificationBell />
        <Link
          to={SharedRoutes.SETTINGS}
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
