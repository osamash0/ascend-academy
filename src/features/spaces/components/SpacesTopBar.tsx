import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BookOpen,
  ChevronDown,
  Compass,
  Home,
  LogOut,
  Orbit,
  Rocket,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';
import { NotificationPanel } from './NotificationPanel';
import { SearchPalette, useSearchPalette } from './SearchPalette';
import { MobileNav } from './MobileNav';
import { viewerStanding } from '../mocks/library';
import type { Person } from '../types';

/**
 * The v4 top bar.
 *
 * Deliberately the *same* chrome as the existing ConsoleTopBar — rocket tile
 * on the left, identity chip beside it, pill tabs with a spring-animated
 * sliding indicator, system tray on the right. Only the destinations change.
 *
 * It is a separate component rather than a reuse of ConsoleTopBar because that
 * one reads `useAuth` and mounts NotificationBell/UploadsIndicator, all of
 * which hit the backend — and this namespace is mock-data-only. The visual
 * language is copied on purpose; the data dependency is not.
 *
 * Destinations are the locked five: Home · Spaces · Library · Social · Profile.
 * Where Create and ⌘K finally live is still Doc 2's call.
 */

export type NavKey = 'home' | 'spaces' | 'library' | 'social' | 'profile';

const TABS: { key: NavKey; label: string; icon: typeof Home }[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'spaces', label: 'Spaces', icon: Orbit },
  { key: 'library', label: 'Library', icon: BookOpen },
  { key: 'social', label: 'Social', icon: Users },
  { key: 'profile', label: 'Profile', icon: Compass },
];

interface Props {
  active: NavKey;
  viewer: Person;
  /**
   * Mock progression — the real values come from the XP engine later.
   * Defaults read `viewerStanding()` so the bar and Social cannot disagree.
   */
  rank?: string;
  xp?: number;
  onNavigate?: (key: NavKey) => void;
}

export function SpacesTopBar({
  active,
  viewer,
  rank = viewerStanding().rank,
  xp = viewerStanding().xp,
  onNavigate,
}: Props) {
  const navigate = useNavigate();
  /*
   * The bar owns the palette rather than each screen passing an `onSearch`.
   * ⌘K is global by definition — threading a callback through nine screens
   * would mean nine chances for one of them to forget, and the shortcut would
   * silently work everywhere except there.
   */
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchPalette();
  /** The five destinations, as routes. Deep-linkable, per Doc 2. */
  const go = (key: NavKey) => {
    if (onNavigate) return onNavigate(key);
    navigate(key === 'spaces' ? '/v4/spaces' : `/v4/${key}`);
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex items-center justify-between gap-4 px-5 py-3 lg:px-10',
        'bg-gradient-to-b from-[#070b14]/80 via-[#070b14]/30 to-transparent backdrop-blur-[2px]',
      )}
    >
      {/* Left: rocket + identity. shrink-0 so a long name can never compress
          this group into the tabs — the bug the old bar had to fix twice. */}
      <div className="flex shrink-0 items-center gap-4">
        <button
          type="button"
          onClick={() => go('home')}
          aria-label="Home"
          className="console-focusable flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-primary to-secondary shadow-glow-primary transition-transform hover:scale-105"
        >
          <Rocket aria-hidden className="h-6 w-6 text-white" />
        </button>

        <button
          type="button"
          onClick={() => go('profile')}
          aria-label="Open account menu"
          className="console-focusable group -mx-1.5 hidden min-w-0 items-center gap-3 rounded-[16px] px-1.5 py-1 transition-colors hover:bg-white/5 md:flex"
        >
          <Avatar person={viewer} size="lg" isViewer className="shadow-glow-primary" />
          <span className="min-w-0 text-left leading-tight">
            <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
              <span className="max-w-[140px] truncate">{viewer.name}</span>
              <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-quiet transition-colors group-hover:text-foreground" />
            </span>
            {/*
              Rank, not Level. Foundations Rule 7 locks progression to XP and
              Rank; "Lvl" is v3 vocabulary that the old bar still shows.
            */}
            <span className="flex items-center gap-1.5 text-xs font-bold text-quiet tabular-nums">
              <span className="text-primary">{rank}</span>
              <span aria-hidden className="text-decor">·</span>
              <span>{xp.toLocaleString()} XP</span>
            </span>
          </span>
        </button>
      </div>

      {/*
        Center: pill tabs with the shared sliding indicator.

        Hidden below `md`, where `MobileNav` carries the same five
        destinations at the bottom. Two navigation controls on one screen is
        two things that have to agree about which tab is active.
      */}
      <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => go(tab.key)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'console-focusable relative flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors lg:px-4',
                isActive ? 'text-white' : 'text-quiet hover:text-foreground',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="v4Tab"
                  className="absolute inset-0 rounded-full bg-white/10"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <tab.icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10 hidden lg:inline">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: system tray. */}
      <div className="flex items-center gap-2 lg:gap-3">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="console-focusable flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-quiet transition hover:bg-white/10 hover:text-foreground"
        >
          <Search aria-hidden className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Ask anything</span>
          <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 text-[10px] font-semibold lg:inline">
            ⌘K
          </kbd>
        </button>

        {/*
          No global create button. Doc 2 (Create, rule 1) is explicit: create
          lives on the screen that owns the object, because a global "+" has to
          ask where the new thing belongs — the folder-brain habit the model
          deliberately avoids. "New Space" therefore sits on the Spaces screen.
        */}

        <NotificationPanel />
        {/*
          The gear navigates; it does not open a panel. Settings is dense enough
          to be a Studio screen, and a panel would have to be dismissed before
          you could act on anything you read in it.
        */}
        <button
          type="button"
          onClick={() => navigate('/v4/settings')}
          aria-label="Settings"
          className="console-focusable flex h-9 w-9 items-center justify-center rounded-full text-quiet transition hover:bg-white/10 hover:text-foreground"
        >
          <Settings aria-hidden className="h-5 w-5" />
        </button>
        {/*
          NEEDS-BACKEND: signing out ends a session, and this namespace has
          none. It stays visible because its absence would misrepresent the
          chrome, and says plainly that it is not wired rather than looking
          like a button that silently failed.
        */}
        <button
          type="button"
          disabled
          title="Not wired in this design build"
          aria-label="Sign out — not wired in this design build"
          className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full text-quiet opacity-45"
        >
          <LogOut aria-hidden className="h-5 w-5" />
        </button>
      </div>

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <MobileNav active={active} />
    </header>
  );
}
