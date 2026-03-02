import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  GraduationCap,
  LayoutDashboard,
  BookOpen,
  Trophy,
  BarChart3,
  Upload,
  LogOut,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Star,
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
  { title: 'Settings', url: '/settings', icon: Settings },
];

const professorNavItems = [
  { title: 'Dashboard', url: '/professor/dashboard', icon: LayoutDashboard },
  { title: 'Analytics', url: '/professor/analytics', icon: BarChart3 },
  { title: 'Upload Lecture', url: '/professor/upload', icon: Upload },
  { title: 'Settings', url: '/settings', icon: Settings },
];

export function AppSidebar() {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const navItems = role === 'professor' ? professorNavItems : studentNavItems;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <button
          onClick={() => navigate(role === 'professor' ? '/professor/dashboard' : '/dashboard')}
          className="flex items-center gap-3 w-full hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center flex-shrink-0">
            <GraduationCap className="w-6 h-6 text-primary-foreground" />
          </div>
          {!isCollapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-bold text-lg text-sidebar-foreground"
            >
              Learnstation
            </motion.span>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent>
        {/* XP Display (Students only) */}
        {role === 'student' && profile && !isCollapsed && (
          <div className="px-4 py-3">
            <div className="bg-sidebar-accent rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-xp" />
                  <span className="text-sm font-medium text-sidebar-foreground">
                    Level {profile.current_level}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xp">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm font-bold">{profile.total_xp}</span>
                </div>
              </div>
              <div className="h-2 bg-sidebar-border rounded-full overflow-hidden">
                <div
                  className="h-full gradient-xp transition-all duration-300"
                  style={{ width: `${(profile.total_xp % 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>
            {role === 'professor' ? 'Professor' : 'Student'} Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location.pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link to={item.url}>
                        <item.icon className="w-5 h-5" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="space-y-4">
          {!isCollapsed && (
            <div className="flex items-center gap-3 px-2 py-1">
              <div className="w-10 h-10 rounded-full border border-border shadow-sm overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="User Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-muted-foreground font-semibold text-sm">
                    {profile?.full_name?.charAt(0)?.toUpperCase() || profile?.email?.charAt(0)?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col overflow-hidden">
                <p className="text-sm font-semibold text-sidebar-foreground truncate">
                  {profile?.full_name || profile?.email}
                </p>
                <p className="text-xs text-muted-foreground capitalize">{role}</p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={handleSignOut}
          >
            <LogOut className="w-5 h-5" />
            {!isCollapsed && <span className="ml-2">Sign out</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
