import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  GraduationCap,
  LayoutDashboard,
  Trophy,
  BarChart3,
  Upload,
  LogOut,
  Users,
  Settings,
  Zap,
  Star,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';

const studentNavItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Achievements', url: '/achievements', icon: Trophy },
  { title: 'Leaderboard', url: '/leaderboard', icon: Users },
  { title: 'Learning Insights', url: '/insights', icon: BarChart3 },
  { title: 'Settings', url: '/settings', icon: Settings },
];

const professorNavItems = [
  { title: 'Dashboard', url: '/professor/dashboard', icon: LayoutDashboard },
  { title: 'Courses', url: '/professor/courses', icon: BookOpen },
  { title: 'Analytics', url: '/professor/analytics', icon: BarChart3 },
  { title: 'Upload Lecture', url: '/professor/upload', icon: Upload },
  { title: 'Settings', url: '/settings', icon: Settings },
];

export function AppSidebar() {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const navItems = role === 'professor' ? professorNavItems : studentNavItems;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleLogoClick = () => {
    navigate(role === 'professor' ? '/professor/dashboard' : '/dashboard');
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-white/5 bg-background/50 backdrop-blur-xl">
      <SidebarHeader className="p-6">
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-4 w-full transition-all cursor-pointer group"
        >
          <div className="w-12 h-12 rounded-[18px] bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0 shadow-glow-primary group-hover:scale-110 transition-all duration-500">
            <GraduationCap className="w-7 h-7 text-white drop-shadow-glow-white/30" />
          </div>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col items-start"
            >
              <span className="font-bold text-lg text-foreground tracking-tighter leading-none mb-1">
                Ascend
              </span>
              <span className="text-[10px] text-primary font-bold uppercase tracking-[0.3em] leading-none">
                v2.0 Orbital
              </span>
            </motion.div>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent className="px-3">
        {/* XP Display (Students only) */}
        {role === 'student' && profile && !isCollapsed && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-2 py-6"
          >
            <div className="glass-panel border-white/5 rounded-[24px] p-5 space-y-4 relative overflow-hidden group hover:border-primary/30 transition-all duration-500">
              <div className="absolute top-0 right-0 w-24 h-24 bg-xp/5 blur-2xl rounded-full -mr-12 -mt-12 group-hover:bg-xp/10 transition-colors" />

              <div className="flex items-center justify-between relative z-10">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Current Tier</span>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-xp/20 flex items-center justify-center">
                      <Star className="w-3.5 h-3.5 text-xp fill-xp" />
                    </div>
                    <span className="text-sm font-bold text-foreground">Level {profile.current_level}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Telemetry</span>
                  <div className="flex items-center gap-1.5 text-xp">
                    <Zap className="w-3.5 h-3.5 fill-xp" />
                    <span className="text-sm font-bold tracking-tighter">{profile.total_xp.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 relative z-10">
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                  <motion.div
                    className="h-full bg-gradient-to-r from-xp via-warning to-xp rounded-full relative shadow-glow-xp/50"
                    initial={{ width: 0 }}
                    animate={{ width: `${(profile.total_xp % 100)}%` }}
                    transition={{ duration: 1.5, ease: [0.34, 1.56, 0.64, 1] }}
                  >
                    <div className="absolute top-0 right-0 bottom-0 w-4 bg-gradient-to-l from-white/30 to-transparent" />
                  </motion.div>
                </div>
                <div className="flex justify-between items-center text-[8px] text-muted-foreground font-bold uppercase tracking-[0.2em]">
                  <span>Protocol Progress</span>
                  <span className="text-foreground">{profile.total_xp % 100}%</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground/30 mb-4">
            Navigation Hub
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navItems.map((item) => {
                const isActive = location.pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={`h-12 rounded-[14px] transition-all duration-300 ${
                        isActive 
                          ? 'bg-primary/10 text-primary shadow-glow-primary/10 border border-primary/20' 
                          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent'
                      }`}
                    >
                      <Link to={item.url} className="flex items-center gap-3 px-4">
                        <item.icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
                        <span className="font-bold tracking-tight">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-6 mt-auto">
        <div className="space-y-6">
          {!isCollapsed && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => navigate('/settings')}
              className="flex items-center gap-4 p-4 cursor-pointer glass-panel border-white/5 rounded-[20px] transition-all group hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="relative w-11 h-11 rounded-[14px] border border-white/10 overflow-hidden flex-shrink-0 bg-surface-2 shadow-xl group-hover:border-primary/50 transition-all duration-500 group-hover:scale-105">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="User avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-secondary/20 to-xp/20">
                    <span className="text-primary font-bold text-base">
                      {profile?.full_name?.charAt(0)?.toUpperCase() || profile?.email?.charAt(0)?.toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors" />
              </div>
              <div className="flex flex-col min-w-0">
                <p className="text-sm font-bold text-foreground truncate tracking-tight group-hover:text-primary transition-colors">
                  {profile?.full_name || profile?.email?.split('@')[0]}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-primary font-bold uppercase tracking-widest">
                  <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                  {role}
                </div>
              </div>
            </motion.div>
          )}
          <Button
            variant="ghost"
            className="w-full h-12 justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-[14px] px-4 transition-all"
            onClick={handleSignOut}
          >
            <LogOut className="w-5 h-5" />
            {!isCollapsed && <span className="ml-3 font-bold tracking-tight">Sign out</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
